-- Cursor control and the human-cursor push stream.
--
-- The write side backs `nvim.window.cursor.set`: pi moves
-- the cursor in a window it owns; this never targets the
-- human's focused window unless pi passes that window id
-- explicitly. Window 0 means the current window.
--
-- The read side backs `nvim.cursor.stream`: pi watches the
-- human's cursor through CursorMoved/CursorMovedI autocmds
-- and pushes a debounced snapshot to a sink (rpcnotify, in
-- production). pi's own edits move the cursor too, so the
-- mutators wrap their work in `suppress` and those moves
-- never echo back as if the human made them.

local uv = vim.uv or vim.loop

local M = {}

--- Push-stream state. Module-level so suppress() can guard
--- emission no matter which call site triggers the move.
local stream = {
  group = nil, ---@type integer?
  timer = nil, ---@type uv.uv_timer_t?
  debounce_ms = 40,
  suppress_depth = 0,
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

--- The default sink: push the snapshot to pi over RPC.
local function default_sink(payload)
  require("neovim-pi.rpc").notify("cursor.moved", { payload })
end

--- Sample the current cursor and hand it to the sink.
local function emit()
  local snapshot = M.get(0)
  snapshot.source = "human"
  local sink = stream.sink or default_sink
  sink(snapshot)
end

--- React to a cursor-movement autocmd. Suppressed moves
--- (pi's own edits) are dropped; otherwise the emit is
--- debounced through a vim.uv timer so a burst of moves
--- collapses to one push. A zero debounce emits inline,
--- which keeps the autocmd path synchronous under test.
local function on_event()
  if stream.suppress_depth > 0 then
    return
  end
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
  stream.suppress_depth = 0
  stream.group = vim.api.nvim_create_augroup("neovim_pi_cursor_stream", { clear = true })
  vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
    group = stream.group,
    callback = on_event,
  })
end

--- Run fn with cursor emission suppressed, so the moves
--- pi's own edits cause never echo back as human moves.
--- Re-entrant: the depth counter survives nesting, and the
--- block is unwound even when fn errors.
---@param fn fun()
function M.suppress(fn)
  stream.suppress_depth = stream.suppress_depth + 1
  local ok, err = pcall(fn)
  stream.suppress_depth = stream.suppress_depth - 1
  if not ok then
    error(err)
  end
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
  stream.suppress_depth = 0
end

return M
