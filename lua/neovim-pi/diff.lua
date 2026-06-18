-- Diff views on the stage.
--
-- pi shows comparisons in windows it owns, never the window
-- the human is focused on. This is a view: the buffers are
-- not claimed for editing in the ownership ledger, and the
-- windows are pi's to close.

local M = {}

local stage = require("neovim-pi.stage")

--- Load a file into a buffer and show it in a window.
---@param win integer
---@param path string
---@return integer bufnr
local function show(win, path)
  local bufnr = vim.fn.bufadd(vim.fn.fnamemodify(path, ":p"))
  vim.fn.bufload(bufnr)
  vim.api.nvim_win_set_buf(win, bufnr)
  return bufnr
end

--- Show two real files side by side as a diff.
---
--- The left file lands on pi's primary stage and the right
--- splits beside it, so the comparison appears in pi-owned
--- windows without moving the human's focus. Diff mode is
--- turned on in both windows with `diffthis`, run inside the
--- window so it acts on the right one. The buffers are plain
--- file buffers, not claimed for editing, since this is a
--- comparison rather than an edit session.
---@param left string path to the left file
---@param right string path to the right file
---@return { left: { win: integer, bufnr: integer }, right: { win: integer, bufnr: integer } }
function M.files(left, right)
  local left_win = stage.ensure()
  local left_buf = show(left_win, left)

  local right_win = stage.open("vsplit")
  local right_buf = show(right_win, right)

  for _, win in ipairs({ left_win, right_win }) do
    vim.api.nvim_win_call(win, function()
      vim.cmd("diffthis")
    end)
  end

  return {
    left = { win = left_win, bufnr = left_buf },
    right = { win = right_win, bufnr = right_buf },
  }
end

--- Turn off diff mode in a window pi owns.
---
--- Refuses any window pi did not create, so the human's
--- windows are left alone. Pairs with `window.close` for full
--- teardown: `off` ends the diff, close removes the window.
---@param win integer
---@return { ok: boolean, error: string? }
function M.off(win)
  if not stage.owns(win) then
    return { ok = false, error = "pi does not own this window" }
  end
  vim.api.nvim_win_call(win, function()
    vim.cmd("diffoff")
  end)
  return { ok = true }
end

return M
