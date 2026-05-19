-- `pi://` buffer adapter.
--
-- Registers a `BufReadCmd` that resolves `pi://` URIs by
-- calling back to the pi peer. The resulting buffer is
-- read-only, transient (`bufhidden=wipe`) and immune to
-- LSP attach.
--
-- Buffer-local default keymaps are installed only on
-- buffers we own. We never touch the user's other
-- buffers.

local M = {}

local rpc = require("neovim-pi.rpc")

---@type integer?
local augroup = nil

--- Enable the adapter. Idempotent.
function M.enable()
  if augroup then
    return
  end
  augroup = vim.api.nvim_create_augroup("neovim-pi-buffer", { clear = true })

  vim.api.nvim_create_autocmd("BufReadCmd", {
    group = augroup,
    pattern = "pi://*",
    callback = function(args)
      M._read(args.buf, args.match)
    end,
  })

  vim.api.nvim_create_autocmd("BufWriteCmd", {
    group = augroup,
    pattern = "pi://*",
    callback = function()
      vim.notify("neovim-pi: pi:// buffers are read-only", vim.log.levels.WARN)
    end,
  })
end

--- Disable the adapter and remove autocmds.
function M.disable()
  if augroup then
    vim.api.nvim_del_augroup_by_id(augroup)
    augroup = nil
  end
end

--- Open a `pi://` URI in a buffer and (optionally) focus the window.
---@param uri string
---@param focus boolean?
function M.open(uri, focus)
  local bufnr = vim.fn.bufadd(uri)
  vim.fn.bufload(bufnr)
  if focus ~= false then
    vim.api.nvim_set_current_buf(bufnr)
  end
  return bufnr
end

--- Close a `pi://` buffer by URI. Returns true if removed.
---@param uri string
function M.close(uri)
  local bufnr = vim.fn.bufnr(uri)
  if bufnr < 0 then
    return false
  end
  vim.api.nvim_buf_delete(bufnr, { force = true })
  return true
end

--- True when any buffer for `path` has unsaved changes.
---@param path string
function M.is_modified(path)
  local target = vim.fs.normalize(path)
  for _, b in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(b) then
      local name = vim.fs.normalize(vim.api.nvim_buf_get_name(b))
      if name == target and vim.bo[b].modified then
        return true
      end
    end
  end
  return false
end

--- Force-reload any buffer for `path` from disk.
---@param path string
function M.reload(path)
  local target = vim.fs.normalize(path)
  for _, b in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(b) then
      local name = vim.fs.normalize(vim.api.nvim_buf_get_name(b))
      if name == target then
        vim.api.nvim_buf_call(b, function()
          vim.cmd("edit!")
        end)
      end
    end
  end
end

--- Mark a `pi://` buffer as stale (pi has disconnected).
---@param uri string
function M.mark_stale(uri)
  local bufnr = vim.fn.bufnr(uri)
  if bufnr < 0 then
    return
  end
  vim.b[bufnr]["neovim_pi_stale"] = true
end

-- -- internal --

--- Resolve a `pi://` URI by asking pi for its contents.
function M._read(bufnr, uri)
  vim.bo[bufnr].buftype = "nowrite"
  vim.bo[bufnr].bufhidden = "wipe"
  vim.bo[bufnr].swapfile = false

  rpc.call("buffer.uri.resolve", { uri }, function(err, result)
    if err then
      vim.schedule(function()
        vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, {
          "neovim-pi: failed to resolve " .. uri,
          "error: " .. tostring(err),
        })
        vim.bo[bufnr].modifiable = false
      end)
      return
    end

    vim.schedule(function()
      local lines = (result and result.lines) or {
        "neovim-pi: no content returned for " .. uri,
        "",
        "The pi peer accepted the request but returned no lines. " ..
          "Some extension owns this URI scheme but didn't fill in content.",
      }
      local filetype = (result and result.filetype) or ""
      vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, lines)
      if filetype ~= "" then
        vim.bo[bufnr].filetype = filetype
      end
      vim.bo[bufnr].modifiable = false
      vim.bo[bufnr].readonly = true
      vim.api.nvim_exec_autocmds("User", {
        pattern = "NeovimPiBufferLoaded",
        data = { uri = uri, bufnr = bufnr },
      })
    end)
  end)
end

return M
