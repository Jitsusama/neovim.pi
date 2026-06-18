-- Real files on the stage.
--
-- Unlike `buffer.lua`, which renders read-only `pi://` URIs,
-- this opens an actual file from disk into a normal,
-- editable buffer and shows it on pi's stage window. The
-- buffer is claimed in the ownership ledger so the edit path
-- will write it; files the human opened are not pi's to
-- touch.

local M = {}

local stage = require("neovim-pi.stage")
local owned = require("neovim-pi.owned")
local cursor = require("neovim-pi.cursor")

--- Open a file on the stage window.
---
--- Loads the file into a listed buffer, displays it on the
--- stage (which never steals the human's focus) and records
--- pi's ownership. Returns the bufnr, the resolved absolute
--- path and the current line count so the agent can frame
--- ranges without a second round trip.
---@param path string
---@param opts { mode: ("current"|"split"|"vsplit")?, line: integer?, col: integer? }?
---@return { bufnr: integer, path: string, lines: integer, win: integer }
function M.open(path, opts)
  opts = opts or {}
  local mode = opts.mode or "current"
  local abspath = vim.fn.fnamemodify(path, ":p")

  -- pi never edits the human's dirty work. If a buffer for this
  -- file is already loaded with unsaved changes and pi does not
  -- own it, refuse rather than adopt it: nvim has one buffer per
  -- file, so adopting would route pi's edits straight into the
  -- human's unsaved buffer.
  local existing = vim.fn.bufnr(abspath)
  if
    existing >= 0
    and vim.api.nvim_buf_is_loaded(existing)
    and vim.bo[existing].modified
    and not owned.has(existing)
  then
    error("file is open in nvim with unsaved changes; pi will not edit the human's dirty buffer")
  end

  local bufnr = vim.fn.bufadd(abspath)
  vim.fn.bufload(bufnr)
  vim.bo[bufnr].buflisted = true

  local win = mode == "current" and stage.ensure() or stage.open(mode)
  vim.api.nvim_win_set_buf(win, bufnr)

  owned.claim(bufnr)

  if opts.line then
    cursor.set(win, opts.line, opts.col or 0)
  end

  return {
    bufnr = bufnr,
    path = abspath,
    lines = vim.api.nvim_buf_line_count(bufnr),
    win = win,
  }
end

--- Save a stage buffer pi owns to its file.
---
--- Only buffers pi opened are pi's to write; the human's
--- buffers are saved by the human. A format-on-save autocmd,
--- if the user has one, runs as part of the write and may
--- change the content, so the caller should re-read after.
---@param bufnr integer
---@return { ok: boolean, modified: boolean?, changedtick: integer?, error: string? }
function M.save(bufnr)
  if not owned.has(bufnr) then
    return { ok = false, error = "pi did not open this buffer" }
  end

  vim.api.nvim_buf_call(bufnr, function()
    vim.cmd("write")
  end)

  return {
    ok = true,
    modified = vim.bo[bufnr].modified,
    changedtick = vim.api.nvim_buf_get_changedtick(bufnr),
  }
end

return M
