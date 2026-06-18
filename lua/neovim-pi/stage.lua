-- pi's stage windows.
--
-- The shared unit between pi and the human is the buffer;
-- the owned unit is the window. pi places the files it opens
-- in windows it owns, never in the window the human is
-- focused on. That dissolves the whole class of problems
-- where pi scrolls, swaps or closes the buffer out from
-- under someone mid-edit.
--
-- pi can own more than one window: a primary stage created
-- lazily on first use, plus any splits it opens beside it.
-- Every window pi creates is opened with `enter = false`, so
-- an open never moves the human's focus. The ownership set
-- lets the close verb refuse a window pi does not own.

local M = {}

---@type integer? handle of pi's primary stage window
local stage_win = nil

---@type table<integer, boolean> every window pi created
local owned_windows = {}

--- Drop window handles that are no longer valid.
local function prune()
  for win in pairs(owned_windows) do
    if not vim.api.nvim_win_is_valid(win) then
      owned_windows[win] = nil
    end
  end
end

--- The primary stage window, or nil if pi does not hold one.
---@return integer?
function M.current()
  if stage_win and vim.api.nvim_win_is_valid(stage_win) then
    return stage_win
  end
  return nil
end

--- Ensure pi has a primary stage window and return it.
---
--- Lazily creates a vertical split to the right of the
--- current window, showing a throwaway scratch buffer until a
--- real file lands in it. Opened with `enter = false` so the
--- human keeps focus. A stale handle is transparently
--- replaced.
---@return integer window handle
function M.ensure()
  local live = M.current()
  if live then
    return live
  end

  local scratch = vim.api.nvim_create_buf(false, true)
  stage_win = vim.api.nvim_open_win(scratch, false, { split = "right", win = 0 })
  owned_windows[stage_win] = true
  return stage_win
end

--- Open an additional stage window beside the primary.
---
--- `mode` is "split" (horizontal) or "vsplit" (vertical). The
--- new window splits off pi's primary stage rather than the
--- human's window, and is opened without moving focus.
---@param mode "split"|"vsplit"
---@return integer window handle
function M.open(mode)
  local base = M.ensure()
  local direction = mode == "split" and "below" or "right"
  local scratch = vim.api.nvim_create_buf(false, true)
  local win = vim.api.nvim_open_win(scratch, false, { split = direction, win = base })
  owned_windows[win] = true
  return win
end

--- Whether pi created and still owns this window.
---@param win integer
---@return boolean
function M.owns(win)
  prune()
  return owned_windows[win] == true
end

--- Drop pi's claim on its windows without closing them.
---
--- Called when pi detaches: the windows and whatever they
--- show stay put for the human, but pi will create fresh
--- ones next time rather than reusing windows the human may
--- have repurposed.
function M.forget()
  stage_win = nil
  owned_windows = {}
end

return M
