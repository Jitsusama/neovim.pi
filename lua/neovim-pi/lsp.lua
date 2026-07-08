-- LSP query forwarding.
--
-- Backs the `nvim.lsp.query` capability: pi's `lsp` tool
-- resolves a paired-editor backend and routes each operation
-- here, so the agent uses the servers already running in the
-- user's nvim rather than a second set pi spawns.
--
-- Every function normalizes to the tool's coordinate
-- convention: a 1-indexed line and a 0-indexed UTF-8 byte
-- column. The LSP protocol is 0-indexed and counts UTF-16
-- code units, so we translate at this edge using the
-- attached client's offset encoding. Positions in results
-- are converted against the target file's own bytes.
--
-- Each function returns a plain table so it serializes over
-- msgpack: `{ ok = true, items = {...} }` on success, or
-- `{ ok = false, reason = "no-client" }` when no language
-- server serves the file.

local M = {}

-- Milliseconds to wait for a synchronous request to answer.
local REQUEST_TIMEOUT = 5000

-- Milliseconds to wait for a language server to attach to a
-- freshly opened buffer before giving up.
local ATTACH_TIMEOUT = 5000

-- Milliseconds to wait for diagnostics to arrive on a file
-- with an attached server. A clean file waits the full span.
local DIAGNOSTIC_TIMEOUT = 1500

-- Milliseconds to wait, after a server attaches, for it to
-- publish diagnostics once. That first publish signals the
-- server has built the project, so position queries
-- (definition, references, hover) no longer race an unbuilt
-- program and come back empty. A file that never publishes
-- waits the full span, then queries best-effort.
local READY_TIMEOUT = 5000

-- vim.diagnostic.severity integers to the tool's words.
local SEVERITY = { [1] = "error", [2] = "warning", [3] = "information", [4] = "hint" }

-- LSP SymbolKind integers to readable names.
local SYMBOL_KIND = {
  [1] = "file",
  [2] = "module",
  [3] = "namespace",
  [4] = "package",
  [5] = "class",
  [6] = "method",
  [7] = "property",
  [8] = "field",
  [9] = "constructor",
  [10] = "enum",
  [11] = "interface",
  [12] = "function",
  [13] = "variable",
  [14] = "constant",
  [15] = "string",
  [16] = "number",
  [17] = "boolean",
  [18] = "array",
  [19] = "object",
  [20] = "key",
  [21] = "null",
  [22] = "enum-member",
  [23] = "struct",
  [24] = "event",
  [25] = "operator",
  [26] = "type-parameter",
}

--- Convert a 0-indexed UTF-8 byte column to a column counted
--- in `encoding` units, for building a request position.
--- Tolerates both the modern `str_utfindex(s, encoding, i)`
--- signature and the legacy `str_utfindex(s, i)` form.
---@param text string the line's bytes
---@param byte_col integer 0-indexed byte column
---@param encoding string "utf-8" | "utf-16" | "utf-32"
---@return integer
local function byte_to_unit(text, byte_col, encoding)
  if encoding == "utf-8" then
    return byte_col
  end
  byte_col = math.min(byte_col, #text)
  local ok, res = pcall(vim.str_utfindex, text, encoding, byte_col)
  if ok then
    return res
  end
  local utf32, utf16 = vim.str_utfindex(text, byte_col)
  return encoding == "utf-32" and utf32 or utf16
end

--- Convert a column counted in `encoding` units to a
--- 0-indexed UTF-8 byte column, for reading a result
--- position. Tolerates both str_byteindex signatures and
--- clamps rather than erroring past the line end.
---@param text string the line's bytes
---@param unit_col integer column in `encoding` units
---@param encoding string "utf-8" | "utf-16" | "utf-32"
---@return integer
local function unit_to_byte(text, unit_col, encoding)
  if encoding == "utf-8" then
    return math.min(unit_col, #text)
  end
  local ok, res = pcall(vim.str_byteindex, text, encoding, unit_col)
  if ok then
    return res
  end
  local legacy_ok, legacy = pcall(vim.str_byteindex, text, unit_col, encoding == "utf-16")
  if legacy_ok then
    return legacy
  end
  return #text
end

local function pos(line, character)
  return { line = line, character = character }
end

local function range(start_line, start_char, end_line, end_char)
  return { start = pos(start_line, start_char), ["end"] = pos(end_line, end_char) }
end

--- Load a buffer for a path without switching to it, and
--- return its bytes for a given 0-indexed line.
---@param path string
---@param line0 integer 0-indexed line
---@return string
local function line_text(path, line0)
  local bufnr = vim.fn.bufadd(path)
  vim.fn.bufload(bufnr)
  return vim.api.nvim_buf_get_lines(bufnr, line0, line0 + 1, false)[1] or ""
end

--- Convert an LSP position (0-indexed line, encoding-unit
--- column) on a file to the tool's convention.
local function convert_pos(path, p, encoding)
  local text = line_text(path, p.line)
  return p.line + 1, unit_to_byte(text, p.character, encoding)
end

--- Convert an LSP range on a file to the tool's convention.
local function convert_range(path, rng, encoding)
  local start_line, start_char = convert_pos(path, rng.start, encoding)
  local end_line, end_char = convert_pos(path, rng["end"], encoding)
  return range(start_line, start_char, end_line, end_char)
end

--- Build an LSP request position from the tool's convention.
local function request_pos(bufnr, line, col, encoding)
  local text = vim.api.nvim_buf_get_lines(bufnr, line - 1, line, false)[1] or ""
  return pos(line - 1, byte_to_unit(text, col, encoding))
end

--- Wait for the attached server to publish diagnostics once,
--- so the project is built before a position query. Returns
--- immediately when diagnostics are already present.
local function wait_ready(bufnr)
  if #vim.diagnostic.get(bufnr) > 0 then
    return
  end
  local ready = false
  local group = vim.api.nvim_create_augroup("neovim_pi_lsp_ready_" .. bufnr, { clear = true })
  vim.api.nvim_create_autocmd("DiagnosticChanged", {
    group = group,
    buffer = bufnr,
    callback = function()
      ready = true
    end,
  })
  vim.wait(READY_TIMEOUT, function()
    return ready
  end, 50)
  vim.api.nvim_del_augroup_by_id(group)
end

--- Open the buffer for `path` and wait for a language server
--- to attach. Returns the bufnr, or nil when none attaches.
local function ensure_buf(path)
  local bufnr = vim.fn.bufadd(path)
  vim.fn.bufload(bufnr)
  if vim.bo[bufnr].filetype == "" then
    local ft = vim.filetype.match({ buf = bufnr, filename = path })
    if ft then
      vim.bo[bufnr].filetype = ft
    end
  end
  local attached = vim.wait(ATTACH_TIMEOUT, function()
    return #vim.lsp.get_clients({ bufnr = bufnr }) > 0
  end, 50)
  if not attached then
    return nil
  end
  wait_ready(bufnr)
  return bufnr
end

--- The offset encoding of the first client attached to a
--- buffer, defaulting to utf-16 (the protocol default).
local function buffer_encoding(bufnr)
  local clients = vim.lsp.get_clients({ bufnr = bufnr })
  return (clients[1] and clients[1].offset_encoding) or "utf-16"
end

--- Normalize a Location or LocationLink to the tool's shape.
local function normalize_location(loc, encoding)
  local uri = loc.uri or loc.targetUri
  local rng = loc.range or loc.targetSelectionRange or loc.targetRange
  local path = vim.uri_to_fname(uri)
  return { path = path, range = convert_range(path, rng, encoding) }
end

--- Flatten a documentSymbol/symbolInformation tree to the
--- tool's flat symbol list.
local function flatten_symbols(list, path, encoding, container, out)
  for _, symbol in ipairs(list) do
    if symbol.location then
      local target = vim.uri_to_fname(symbol.location.uri)
      out[#out + 1] = {
        name = symbol.name,
        kind = SYMBOL_KIND[symbol.kind] or "unknown",
        location = { path = target, range = convert_range(target, symbol.location.range, encoding) },
        containerName = symbol.containerName,
      }
    else
      local rng = symbol.selectionRange or symbol.range
      out[#out + 1] = {
        name = symbol.name,
        kind = SYMBOL_KIND[symbol.kind] or "unknown",
        location = { path = path, range = convert_range(path, rng, encoding) },
        containerName = container,
      }
      if symbol.children then
        flatten_symbols(symbol.children, path, encoding, symbol.name, out)
      end
    end
  end
end

--- Normalize a WorkspaceEdit to a per-file list of edits in
--- the tool's convention. Handles both `changes` and
--- `documentChanges` forms.
local function normalize_workspace_edit(edit, encoding)
  local out = {}
  local function push(path, edits)
    local converted = {}
    for _, e in ipairs(edits) do
      converted[#converted + 1] =
        { range = convert_range(path, e.range, encoding), newText = e.newText }
    end
    out[#out + 1] = { path = path, edits = converted }
  end
  if edit.documentChanges then
    for _, dc in ipairs(edit.documentChanges) do
      if dc.textDocument and dc.edits then
        push(vim.uri_to_fname(dc.textDocument.uri), dc.edits)
      end
    end
  elseif edit.changes then
    for uri, edits in pairs(edit.changes) do
      push(vim.uri_to_fname(uri), edits)
    end
  end
  return out
end

--- Run a synchronous buffer request and return the first
--- non-nil result across responding clients, or nil.
local function first_result(bufnr, method, params)
  local responses = vim.lsp.buf_request_sync(bufnr, method, params, REQUEST_TIMEOUT)
  if not responses then
    return nil
  end
  for _, response in pairs(responses) do
    if response.result then
      return response.result
    end
  end
  return nil
end

-- Times to retry a position query that comes back empty, with
-- a short pause between. A server can accept the request
-- before it has finished building the program and answer
-- empty; a couple of retries close that residual window
-- without adding much latency to a genuine miss.
local POSITION_RETRIES = 3
local POSITION_RETRY_WAIT = 400

--- Run a position request, retrying briefly while the result
--- is empty. `has_result` reports whether a raw result is
--- non-empty, since emptiness differs by method.
local function retry_result(bufnr, method, params, has_result)
  local result = first_result(bufnr, method, params)
  local attempts = 1
  while not has_result(result) and attempts < POSITION_RETRIES do
    vim.wait(POSITION_RETRY_WAIT)
    result = first_result(bufnr, method, params)
    attempts = attempts + 1
  end
  return result
end

--- Diagnostics for a file, in the tool's convention.
function M.diagnostics(path)
  local bufnr = ensure_buf(path)
  if not bufnr then
    return { ok = false, reason = "no-client" }
  end
  vim.wait(DIAGNOSTIC_TIMEOUT, function()
    return #vim.diagnostic.get(bufnr) > 0
  end, 100)
  local items = {}
  for _, d in ipairs(vim.diagnostic.get(bufnr)) do
    items[#items + 1] = {
      path = path,
      range = range(d.lnum + 1, d.col, (d.end_lnum or d.lnum) + 1, d.end_col or d.col),
      severity = SEVERITY[d.severity] or "information",
      message = d.message,
      source = d.source,
      code = d.code and tostring(d.code) or nil,
    }
  end
  return { ok = true, items = items }
end

local function locations(path, line, col, method, include_declaration)
  local bufnr = ensure_buf(path)
  if not bufnr then
    return { ok = false, reason = "no-client" }
  end
  local encoding = buffer_encoding(bufnr)
  local params = {
    textDocument = { uri = vim.uri_from_bufnr(bufnr) },
    position = request_pos(bufnr, line, col, encoding),
  }
  if method == "textDocument/references" then
    params.context = { includeDeclaration = include_declaration }
  end
  local result = retry_result(bufnr, method, params, function(r)
    return r ~= nil and (r.uri ~= nil or #r > 0)
  end)
  local items = {}
  if result then
    local list = result.uri and { result } or result
    for _, loc in ipairs(list) do
      items[#items + 1] = normalize_location(loc, encoding)
    end
  end
  return { ok = true, items = items }
end

--- Where the symbol under the position is defined.
function M.definition(path, line, col)
  return locations(path, line, col, "textDocument/definition", false)
end

--- Every reference to the symbol under the position.
function M.references(path, line, col)
  return locations(path, line, col, "textDocument/references", true)
end

--- Hover documentation for the symbol under the position.
function M.hover(path, line, col)
  local bufnr = ensure_buf(path)
  if not bufnr then
    return { ok = false, reason = "no-client" }
  end
  local encoding = buffer_encoding(bufnr)
  local result = retry_result(bufnr, "textDocument/hover", {
    textDocument = { uri = vim.uri_from_bufnr(bufnr) },
    position = request_pos(bufnr, line, col, encoding),
  }, function(r)
    return r ~= nil and r.contents ~= nil
  end)
  if not result or not result.contents then
    return { ok = true, hover = nil }
  end
  local lines = vim.lsp.util.convert_input_to_markdown_lines(result.contents)
  local contents = table.concat(lines, "\n")
  if contents == "" then
    return { ok = true, hover = nil }
  end
  local rng = result.range and convert_range(path, result.range, encoding) or nil
  return { ok = true, hover = { contents = contents, range = rng } }
end

--- Symbols declared in one file.
function M.document_symbols(path)
  local bufnr = ensure_buf(path)
  if not bufnr then
    return { ok = false, reason = "no-client" }
  end
  local encoding = buffer_encoding(bufnr)
  local result = first_result(bufnr, "textDocument/documentSymbol", {
    textDocument = { uri = vim.uri_from_bufnr(bufnr) },
  })
  local items = {}
  if result then
    flatten_symbols(result, path, encoding, nil, items)
  end
  return { ok = true, items = items }
end

--- Symbols across the project matching a query.
function M.workspace_symbols(query)
  local clients = vim.lsp.get_clients()
  if #clients == 0 then
    return { ok = false, reason = "no-client" }
  end
  local items = {}
  for _, client in ipairs(clients) do
    if client:supports_method("workspace/symbol") then
      local response =
        client:request_sync("workspace/symbol", { query = query }, REQUEST_TIMEOUT, 0)
      if response and response.result then
        for _, symbol in ipairs(response.result) do
          local path = vim.uri_to_fname(symbol.location.uri)
          items[#items + 1] = {
            name = symbol.name,
            kind = SYMBOL_KIND[symbol.kind] or "unknown",
            location = {
              path = path,
              range = convert_range(path, symbol.location.range, client.offset_encoding),
            },
            containerName = symbol.containerName,
          }
        end
        break
      end
    end
  end
  return { ok = true, items = items }
end

--- Rename the symbol under the position across the project,
--- apply the edits, save the touched files, and report what
--- changed. Ranges are normalized before applying, while they
--- still describe the pre-edit bytes.
function M.rename(path, line, col, new_name)
  local bufnr = ensure_buf(path)
  if not bufnr then
    return { ok = false, reason = "no-client" }
  end
  local encoding = buffer_encoding(bufnr)
  local edit = first_result(bufnr, "textDocument/rename", {
    textDocument = { uri = vim.uri_from_bufnr(bufnr) },
    position = request_pos(bufnr, line, col, encoding),
    newName = new_name,
  })
  if not edit then
    return { ok = true, changes = {} }
  end
  local changes = normalize_workspace_edit(edit, encoding)
  vim.lsp.util.apply_workspace_edit(edit, encoding)
  for _, change in ipairs(changes) do
    local target = vim.fn.bufadd(change.path)
    vim.fn.bufload(target)
    vim.api.nvim_buf_call(target, function()
      vim.cmd("silent keepalt write")
    end)
  end
  return { ok = true, changes = changes }
end

--- Code actions offered for a file, optionally at a range.
--- `srange` is in the tool's convention when present.
function M.code_actions(path, srange)
  local bufnr = ensure_buf(path)
  if not bufnr then
    return { ok = false, reason = "no-client" }
  end
  local encoding = buffer_encoding(bufnr)
  local rng
  if srange then
    rng = {
      start = request_pos(bufnr, srange.start_line, srange.start_char, encoding),
      ["end"] = request_pos(bufnr, srange.end_line, srange.end_char, encoding),
    }
  else
    rng = { start = pos(0, 0), ["end"] = pos(vim.api.nvim_buf_line_count(bufnr), 0) }
  end
  local result = first_result(bufnr, "textDocument/codeAction", {
    textDocument = { uri = vim.uri_from_bufnr(bufnr) },
    range = rng,
    context = { diagnostics = {} },
  })
  local items = {}
  if result then
    for _, action in ipairs(result) do
      items[#items + 1] = { title = action.title, kind = action.kind }
    end
  end
  return { ok = true, items = items }
end

-- Pure helpers exposed for unit tests only.
M.__test = {
  byte_to_unit = byte_to_unit,
  unit_to_byte = unit_to_byte,
  flatten_symbols = flatten_symbols,
  normalize_workspace_edit = normalize_workspace_edit,
  SYMBOL_KIND = SYMBOL_KIND,
}

return M
