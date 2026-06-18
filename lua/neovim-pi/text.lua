-- Range reads and writes on stage buffers.
--
-- The agent-facing coordinate system is uniform: lines are
-- 1-indexed (as an editor shows them) and columns are
-- 0-indexed character offsets, end-exclusive. neovim's
-- buffer API works in 0-indexed rows and byte columns, so
-- every column crosses a character-to-byte translation here,
-- where the line text is in hand. Skipping that translation
-- corrupts any line with multibyte text.

local owned = require("neovim-pi.owned")

local M = {}

--- How long an edit flash stays lit, in milliseconds.
local FLASH_MS = 400

--- Highlight group the edit flash paints with.
local FLASH_HL = "Visual"

--- The flash lives in its own namespace, apart from the
--- shared `nvim.extmark` namespace, so clearing a flash never
--- wipes an agent highlight and overlapping flashes do not
--- clip each other.
local FLASH_NS = vim.api.nvim_create_namespace("neovim-pi-flash")

--- Byte offset of a 0-indexed character column in a line.
---
--- Clamped to the line's length so a column past the end
--- never raises. `vim.str_byteindex` with the "utf-32"
--- encoding treats the index as a codepoint count.
---@param line string
---@param char_col integer
---@return integer byte offset
local function byte_offset(line, char_col)
  if char_col <= 0 then
    return 0
  end
  local char_count = vim.fn.strchars(line)
  if char_col >= char_count then
    return #line
  end
  return vim.str_byteindex(line, "utf-32", char_col)
end

--- Line text at a 0-indexed row, or "" past the end.
---@param bufnr integer
---@param row integer
---@return string
local function line_at(bufnr, row)
  return vim.api.nvim_buf_get_lines(bufnr, row, row + 1, false)[1] or ""
end

--- Read the text in a range.
---@param bufnr integer
---@param start_line integer 1-indexed
---@param start_col integer 0-indexed character column
---@param end_line integer 1-indexed
---@param end_col integer 0-indexed character column, exclusive
---@return { text: string }
function M.get_range(bufnr, start_line, start_col, end_line, end_col)
  local start_row = start_line - 1
  local end_row = end_line - 1

  local start_byte = byte_offset(line_at(bufnr, start_row), start_col)
  local end_byte = byte_offset(line_at(bufnr, end_row), end_col)

  local chunks = vim.api.nvim_buf_get_text(bufnr, start_row, start_byte, end_row, end_byte, {})
  return { text = table.concat(chunks, "\n") }
end

--- Start a fresh undo block in a buffer.
---
--- Re-assigning `undolevels` is the documented way to force
--- an undo boundary (`:h undo-break`). Without it pi's edit
--- can join the previous change, so a single `u` would revert
--- more than pi touched. With it, one `u` reverts exactly the
--- edit that follows.
local function break_undo(bufnr)
  vim.api.nvim_buf_call(bufnr, function()
    vim.bo[bufnr].undolevels = vim.bo[bufnr].undolevels
  end)
end

--- Briefly highlight a range, then clear just this flash.
---
--- The flash shows the human what pi just changed. Rows and
--- columns here are 0-indexed byte positions, matching the
--- extmark API. Clearing deletes only this flash's own
--- extmark by id, so a later flash's wipe never erases an
--- earlier flash still lit or an agent highlight in the
--- shared namespace.
local function flash(bufnr, start_row, start_byte, end_row, end_byte)
  local id = vim.api.nvim_buf_set_extmark(bufnr, FLASH_NS, start_row, start_byte, {
    end_row = end_row,
    end_col = end_byte,
    hl_group = FLASH_HL,
  })
  vim.defer_fn(function()
    if vim.api.nvim_buf_is_valid(bufnr) then
      pcall(vim.api.nvim_buf_del_extmark, bufnr, FLASH_NS, id)
    end
  end, FLASH_MS)
end

--- Replace a character range in a buffer pi owns.
---
--- Refuses a buffer pi never opened, and refuses without
--- writing when `expected_changedtick` no longer matches the
--- buffer, so a stale view never clobbers a change made since
--- the agent last read. A single `nvim_buf_set_text` is one
--- undo step, so the human can revert pi's edit in one `u`.
---@param bufnr integer
---@param start_line integer 1-indexed
---@param start_col integer 0-indexed character column
---@param end_line integer 1-indexed
---@param end_col integer 0-indexed character column, exclusive
---@param replacement string newline-separated replacement text
---@param expected_changedtick integer? refuse if the buffer has moved on
function M.set_range(
  bufnr,
  start_line,
  start_col,
  end_line,
  end_col,
  replacement,
  expected_changedtick
)
  if not owned.has(bufnr) then
    return { ok = false, error = "pi did not open this buffer" }
  end

  local tick = vim.api.nvim_buf_get_changedtick(bufnr)
  if expected_changedtick ~= nil and expected_changedtick ~= tick then
    return { ok = false, conflict = true, changedtick = tick, error = "changedtick mismatch" }
  end

  local start_row = start_line - 1
  local end_row = end_line - 1
  local start_byte = byte_offset(line_at(bufnr, start_row), start_col)
  local end_byte = byte_offset(line_at(bufnr, end_row), end_col)

  break_undo(bufnr)
  local repl_lines = vim.split(replacement, "\n", { plain = true })
  vim.api.nvim_buf_set_text(bufnr, start_row, start_byte, end_row, end_byte, repl_lines)

  local last = repl_lines[#repl_lines]
  local new_end_row, new_end_byte
  if #repl_lines == 1 then
    new_end_row = start_row
    new_end_byte = start_byte + #last
  else
    new_end_row = start_row + #repl_lines - 1
    new_end_byte = #last
  end

  flash(bufnr, start_row, start_byte, new_end_row, new_end_byte)

  local end_line_text = line_at(bufnr, new_end_row)
  return {
    ok = true,
    changedtick = vim.api.nvim_buf_get_changedtick(bufnr),
    end_line = new_end_row + 1,
    end_col = vim.fn.strchars(string.sub(end_line_text, 1, new_end_byte)),
    lines = vim.api.nvim_buf_line_count(bufnr),
  }
end

return M
