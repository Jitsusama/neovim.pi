-- Cursor control.
--
-- Backs the `nvim.window.cursor.set` capability. pi moves
-- the cursor in a window it owns; this never targets the
-- human's focused window unless pi passes that window id
-- explicitly. Window 0 means the current window.

local M = {}

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

return M
