-- Cursor control and the human-cursor push stream.
--
-- The write side backs `nvim.cursor.set`: pi moves
-- the cursor in a window it owns; this never targets the
-- human's focused window unless pi passes that window id
-- explicitly. Window 0 means the current window.
--
-- The read side backs `nvim.cursor.stream`: pi watches the
-- human's cursor through CursorMoved/CursorMovedI autocmds
-- and pushes a debounced snapshot to a sink (rpcnotify, in
-- production). Every snapshot is genuinely the human's: pi's
-- edits land in the windows pi owns rather than the human's
-- focused window, and nvim does not fire CursorMoved for a
-- programmatic `nvim_win_set_cursor` (`:h CursorMoved` fires
-- only on a move the human makes), so pi's own cursor work
-- never echoes into the stream.

local uv = vim.uv or vim.loop

local M = {}

--- Push-stream state. Module-level so the autocmd callback,
--- the debounce timer and unwatch all share one handle set.
local stream = {
  group = nil, ---@type integer?
  timer = nil, ---@type uv.uv_timer_t?
  debounce_ms = 40,
  sink = nil, ---@type fun(payload: table)?
}

--- Move the cursor to a line and column in a window.
---
--- `nvim_win_set_cursor` is 1-indexed for the line and
--- 0-indexed for the column, and it raises on a column past
--- the end of the line. We clamp the column to the line
--- length so a best-effort position never errors.
---@param win integer window handle, or 0 for the current window
---@param line integer 1-indexed line
---@param col integer 0-indexed byte column
function M.set(win, line, col)
  local window = (win == nil or win == 0) and vim.api.nvim_get_current_win() or win
  local bufnr = vim.api.nvim_win_get_buf(window)

  local line_count = vim.api.nvim_buf_line_count(bufnr)
  local target_line = math.max(1, math.min(line, line_count))

  local text = vim.api.nvim_buf_get_lines(bufnr, target_line - 1, target_line, false)[1] or ""
  local target_col = math.max(0, math.min(col, #text))

  vim.api.nvim_win_set_cursor(window, { target_line, target_col })
end

--- Report the live cursor position and buffer for a window.
---
--- `nvim_win_get_cursor` returns a 1-indexed line and a
--- 0-indexed byte column, the same convention `set` takes,
--- so a `get` then `set` round-trips without translation.
---@param win integer? window handle, or 0/nil for the current window
---@return { win: integer, bufnr: integer, name: string, line: integer, col: integer, mode: string }
function M.get(win)
  local window = (win == nil or win == 0) and vim.api.nvim_get_current_win() or win
  local bufnr = vim.api.nvim_win_get_buf(window)
  local pos = vim.api.nvim_win_get_cursor(window)
  return {
    win = window,
    bufnr = bufnr,
    name = vim.api.nvim_buf_get_name(bufnr),
    line = pos[1],
    col = pos[2],
    mode = vim.api.nvim_get_mode().mode,
  }
end

--- Report the human's visual selection in a window.
---
--- Neovim exposes a selection two ways, and which one is
--- live depends on whether the human is still selecting.
--- While visual mode is active the `'<`/`'>` marks still
--- hold the *previous* selection, so the live ends come from
--- `getpos("v")` (the anchor) and `getpos(".")` (the cursor);
--- once visual mode ends those marks catch up and become the
--- source of truth. We normalise both to a 1-indexed line, a
--- 0-indexed column and an inclusive end, then order the ends
--- so a backwards selection still reads start-to-finish.
---@class neovim_pi.Selection
---@field win integer
---@field bufnr integer
---@field kind string visual kind: "v" charwise, "V" linewise, "b" blockwise
---@field start { line: integer, col: integer } 1-indexed line, 0-indexed col
---@field finish { line: integer, col: integer } inclusive end
---@field text string the selected text, lines joined with \n
---@field empty boolean true when nothing has been selected
---@param win integer? window handle, or 0/nil for current
---@return neovim_pi.Selection
function M.get_selection(win)
  local window = (win == nil or win == 0) and vim.api.nvim_get_current_win() or win
  local bufnr = vim.api.nvim_win_get_buf(window)
  local m = vim.api.nvim_get_mode().mode
  local in_visual = m:sub(1, 1):match("[vV\22]") ~= nil

  local sline, scol, eline, ecol, kind
  if in_visual then
    local anchor = vim.fn.getpos("v")
    local point = vim.fn.getpos(".")
    sline, scol = anchor[2], anchor[3] - 1
    eline, ecol = point[2], point[3] - 1
    kind = m:sub(1, 1)
  else
    local s = vim.api.nvim_buf_get_mark(bufnr, "<")
    local e = vim.api.nvim_buf_get_mark(bufnr, ">")
    sline, scol = s[1], s[2]
    eline, ecol = e[1], e[2]
    kind = vim.fn.visualmode()
    if kind == "" then
      kind = "v"
    end
  end

  -- Blockwise is the raw Ctrl-V byte from mode()/visualmode();
  -- report a stable, printable token alongside "v" and "V".
  if kind == "\22" then
    kind = "b"
  end

  if sline == 0 or eline == 0 then
    return {
      win = window,
      bufnr = bufnr,
      kind = kind,
      start = { line = 0, col = 0 },
      finish = { line = 0, col = 0 },
      text = "",
      empty = true,
    }
  end

  if sline > eline or (sline == eline and scol > ecol) then
    sline, scol, eline, ecol = eline, ecol, sline, scol
  end

  local text
  if kind == "V" then
    local lines = vim.api.nvim_buf_get_lines(bufnr, sline - 1, eline, false)
    text = table.concat(lines, "\n")
  else
    -- Charwise (blockwise is approximated as the spanning
    -- charwise range). The end column is inclusive, so add one
    -- for the exclusive end nvim_buf_get_text wants, clamped to
    -- the line so an end-of-line mark never reads past it.
    local last = vim.api.nvim_buf_get_lines(bufnr, eline - 1, eline, false)[1] or ""
    local end_exclusive = math.min(ecol + 1, #last)
    local ok, chunk =
      pcall(vim.api.nvim_buf_get_text, bufnr, sline - 1, scol, eline - 1, end_exclusive, {})
    text = ok and table.concat(chunk, "\n") or ""
  end

  return {
    win = window,
    bufnr = bufnr,
    kind = kind,
    start = { line = sline, col = scol },
    finish = { line = eline, col = ecol },
    text = text,
    empty = false,
  }
end

--- The default sink: push the snapshot to pi over RPC.
local function default_sink(payload)
  require("neovim-pi.rpc").notify("cursor.moved", { payload })
end

--- Sample the current cursor and hand it to the sink. The
--- source is a constant: the stream only ever fires on a
--- human move (see the module header), so there is nothing
--- else it could be.
---
--- `M.get(0)` reads the current window, which is the human's:
--- pi opens its windows with `enter = false` and never
--- focuses them, and the one verb that does move focus
--- (`window.focus`) deliberately puts the human there, so a
--- move emitted afterwards genuinely belongs to the window
--- they now occupy.
local function emit()
  local snapshot = M.get(0)
  snapshot.source = "human"
  local sink = stream.sink or default_sink
  sink(snapshot)
end

--- React to a cursor-movement autocmd. The emit is debounced
--- through a vim.uv timer so a burst of moves collapses to
--- one push. A zero debounce emits inline, which keeps the
--- autocmd path synchronous under test.
local function on_event()
  if stream.debounce_ms <= 0 then
    emit()
    return
  end
  if not stream.timer then
    stream.timer = uv.new_timer()
  end
  stream.timer:stop()
  stream.timer:start(stream.debounce_ms, 0, function()
    vim.schedule(emit)
  end)
end

--- Start streaming the human's cursor to a sink.
---@param opts { sink: fun(payload: table)?, debounce_ms: integer? }?
function M.watch(opts)
  opts = opts or {}
  stream.sink = opts.sink
  stream.debounce_ms = opts.debounce_ms or 40
  stream.group = vim.api.nvim_create_augroup("neovim_pi_cursor_stream", { clear = true })
  vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
    group = stream.group,
    callback = on_event,
  })
end

--- Stop streaming and tear the autocmds and timer down.
--- Idempotent.
function M.unwatch()
  if stream.group then
    pcall(vim.api.nvim_del_augroup_by_id, stream.group)
    stream.group = nil
  end
  if stream.timer then
    stream.timer:stop()
    if not stream.timer:is_closing() then
      stream.timer:close()
    end
    stream.timer = nil
  end
  stream.sink = nil
end

return M
