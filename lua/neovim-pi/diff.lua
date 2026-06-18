-- Diff views on the stage.
--
-- pi shows comparisons in windows it owns, never the window
-- the human is focused on. This is a view: the buffers are
-- not claimed for editing in the ownership ledger, and the
-- windows are pi's to close.

local M = {}

local stage = require("neovim-pi.stage")
local owned = require("neovim-pi.owned")

---@class neovim_pi.DiffSide
---@field win integer
---@field bufnr integer

---@class neovim_pi.PendingDiff
---@field ok boolean
---@field original neovim_pi.DiffSide? the on-disk original
---@field pending neovim_pi.DiffSide? the unsaved edits
---@field error string?

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
---@return { left: neovim_pi.DiffSide, right: neovim_pi.DiffSide }
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

--- Show a buffer's unsaved edits against the file on disk.
---
--- The read side of the editing flow: pi has edited an owned
--- buffer but not saved it, and this shows those pending
--- edits as a live diff against the file's on-disk bytes. It
--- follows the classic `:DiffOrig` pattern, where a throwaway
--- scratch buffer holds the original file content while the
--- real buffer holds the pending edits, and neovim recomputes
--- the diff as pi keeps editing. The original lands on the
--- left (pi's primary stage) and the pending edits split to
--- its right, reading old-to-new without moving the human's
--- focus. The buffer must be one pi owns, since this pairs
--- with `file.save` (persist the edits) and `file.reload`
--- (discard them), which only act on pi's buffers. Tear down
--- with `off` on each window plus `window.close`; the scratch
--- original is `bufhidden = wipe`, so closing its window
--- disposes of it.
---@param bufnr integer
---@return neovim_pi.PendingDiff
function M.pending(bufnr)
  if not owned.has(bufnr) then
    return { ok = false, error = "pi did not open this buffer" }
  end
  local name = vim.api.nvim_buf_get_name(bufnr)
  if name == "" then
    return { ok = false, error = "buffer has no file on disk to diff against" }
  end

  -- The on-disk bytes go in a throwaway scratch on the left...
  local original_buf = vim.api.nvim_create_buf(false, true)
  vim.bo[original_buf].bufhidden = "wipe"
  vim.api.nvim_buf_set_lines(original_buf, 0, -1, false, vim.fn.readfile(name))
  vim.bo[original_buf].filetype = vim.bo[bufnr].filetype
  local original_win = stage.ensure()
  vim.api.nvim_win_set_buf(original_win, original_buf)

  -- ...and the live edited buffer splits to its right.
  local pending_win = stage.open("vsplit")
  vim.api.nvim_win_set_buf(pending_win, bufnr)

  for _, win in ipairs({ original_win, pending_win }) do
    vim.api.nvim_win_call(win, function()
      vim.cmd("diffthis")
    end)
  end

  return {
    ok = true,
    original = { win = original_win, bufnr = original_buf },
    pending = { win = pending_win, bufnr = bufnr },
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
