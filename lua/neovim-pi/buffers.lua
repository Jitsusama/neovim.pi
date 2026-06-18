-- Buffer-list awareness.
--
-- Distinct from `buffer.lua`, which is the read-only `pi://`
-- virtual-buffer adapter. This module reports and manages the
-- editor's real buffers so the agent can see what is open,
-- including buffers loaded but not shown in any window.

local M = {}

local owned = require("neovim-pi.owned")
local stage = require("neovim-pi.stage")

--- List every buffer with its name and state flags.
---@return table[] one entry per buffer
function M.list()
  local result = {}
  for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
    result[#result + 1] = {
      bufnr = bufnr,
      name = vim.api.nvim_buf_get_name(bufnr),
      listed = vim.bo[bufnr].buflisted,
      loaded = vim.api.nvim_buf_is_loaded(bufnr),
      modified = vim.bo[bufnr].modified,
      owned = owned.has(bufnr),
    }
  end
  return result
end

--- Show an existing buffer on pi's stage window.
---
--- Swapping the stage window's displayed buffer is
--- non-destructive: it never edits the buffer, so any valid
--- handle is fair game, not just buffers pi owns. The swap
--- lands in pi's own window and so never moves the human's
--- focus. Editing the buffer afterwards still gates on the
--- ownership ledger.
---@param bufnr integer
---@return { ok: boolean, win: integer?, bufnr: integer?, error: string? }
function M.switch(bufnr)
  if not vim.api.nvim_buf_is_valid(bufnr) then
    return { ok = false, error = "no such buffer" }
  end
  local win = stage.ensure()
  vim.api.nvim_win_set_buf(win, bufnr)
  return { ok = true, win = win, bufnr = bufnr }
end

--- Delete a buffer pi opened.
---
--- Named `delete` (it unloads the buffer via `nvim_buf_delete`)
--- to stay distinct from `window.close`, which only closes a
--- window. Only buffers pi opened are pi's to delete; the
--- human's buffers stay put. A buffer with unsaved changes is
--- the E89 condition (nvim refuses to delete it without
--- force); rather than let that error surface raw, delete
--- reports it as a confirm trigger so the caller can decide
--- whether to discard the edit, then pass `force` to go
--- through with it.
---@param bufnr integer
---@param force boolean?
---@return { ok: boolean, modified: boolean?, error: string? }
function M.delete(bufnr, force)
  if not owned.has(bufnr) then
    return { ok = false, error = "pi did not open this buffer" }
  end
  if not force and vim.bo[bufnr].modified then
    return {
      ok = false,
      modified = true,
      error = "buffer has unsaved changes; pass force to discard them",
    }
  end
  vim.api.nvim_buf_delete(bufnr, { force = force or false })
  owned.release(bufnr)
  return { ok = true }
end

--- Detailed state for a single buffer.
---
--- The single-buffer companion to `list`: same flags, plus
--- the line count and changedtick the agent needs to frame
--- ranges and arm the edit path's conflict check without a
--- separate round trip. The line count is meaningful only
--- once the buffer is loaded.
---@param bufnr integer
---@return table # ok plus list() flags and lines/changedtick, or { ok = false, error }
function M.info(bufnr)
  if not vim.api.nvim_buf_is_valid(bufnr) then
    return { ok = false, error = "no such buffer" }
  end
  local loaded = vim.api.nvim_buf_is_loaded(bufnr)
  return {
    ok = true,
    bufnr = bufnr,
    name = vim.api.nvim_buf_get_name(bufnr),
    listed = vim.bo[bufnr].buflisted,
    loaded = loaded,
    modified = vim.bo[bufnr].modified,
    owned = owned.has(bufnr),
    lines = loaded and vim.api.nvim_buf_line_count(bufnr) or 0,
    changedtick = vim.api.nvim_buf_get_changedtick(bufnr),
  }
end

return M
