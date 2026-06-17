-- pi's stage window.
--
-- The shared unit between pi and the human is the buffer;
-- the owned unit is the window. pi places the files it opens
-- in a window it owns, never in the window the human is
-- focused on. That dissolves the whole class of problems
-- where pi scrolls, swaps or closes the buffer out from
-- under someone mid-edit.
--
-- The stage window is created lazily on first use and to
-- the side of wherever the human currently is. Creating it
-- does not move focus, so an open never interrupts typing.

local M = {}

---@type integer? handle of pi's stage window, when it has one
local stage_win = nil

--- The stage window, or nil if pi does not currently hold one.
---@return integer?
function M.current()
  if stage_win and vim.api.nvim_win_is_valid(stage_win) then
    return stage_win
  end
  return nil
end

--- Ensure pi has a stage window and return it.
---
--- Lazily creates a vertical split to the right of the
--- current window, showing a throwaway scratch buffer until a
--- real file lands in it. The split is opened with `enter =
--- false` so the human keeps focus. A stale handle (the
--- window was closed) is transparently replaced.
---@return integer window handle
function M.ensure()
  local live = M.current()
  if live then
    return live
  end

  local scratch = vim.api.nvim_create_buf(false, true)
  stage_win = vim.api.nvim_open_win(scratch, false, { split = "right", win = 0 })
  return stage_win
end

--- Drop pi's claim on the stage window without closing it.
---
--- Called when pi detaches: the window and whatever it shows
--- stay put for the human, but pi will create a fresh stage
--- next time it needs one rather than reusing a window the
--- human may have repurposed.
function M.forget()
  stage_win = nil
end

return M
