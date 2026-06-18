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

  -- nvim keys buffers by file, so resolve the path to its
  -- buffer through bufadd, which returns the existing buffer
  -- when one is already loaded for this file and creates a
  -- fresh (unloaded) one otherwise. We ask bufadd rather than
  -- vim.fn.bufnr because bufnr matches its argument as a regex
  -- and would miss a path with metacharacters (a literal dot).
  local bufnr = vim.fn.bufadd(abspath)

  -- A buffer already loaded that pi does not own is the
  -- human's (a fresh bufadd is unloaded until we load it
  -- below). pi never edits the human's dirty work, so a
  -- modified one is refused outright. A clean one is shown but
  -- left unclaimed: the edit path and the destructive verbs
  -- all gate on ownership, so not claiming keeps the human's
  -- buffer the human's to touch rather than adopting it and
  -- exposing it to reload/delete.
  local human_owned = vim.api.nvim_buf_is_loaded(bufnr) and not owned.has(bufnr)
  if human_owned and vim.bo[bufnr].modified then
    error("file is open in nvim with unsaved changes; pi will not edit the human's dirty buffer")
  end

  vim.fn.bufload(bufnr)
  vim.bo[bufnr].buflisted = true

  local win = mode == "current" and stage.ensure() or stage.open(mode)
  vim.api.nvim_win_set_buf(win, bufnr)

  if not human_owned then
    owned.claim(bufnr)
  end

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

--- Reload a stage buffer pi owns from its file on disk.
---
--- The inverse of `save`: it pulls the file's current bytes
--- back into the buffer with `:edit!`, which silently discards
--- any unsaved buffer changes. That makes reload destructive,
--- so it mirrors `delete`: only buffers pi owns are pi's to
--- reload, and a modified buffer is a confirm trigger reported
--- as `modified` rather than discarded, with `force` to go
--- through. Returns the post-reload changedtick and line count
--- so the caller can re-arm the edit path's conflict check.
---@param bufnr integer
---@param force boolean?
---@return { ok: boolean, modified: boolean?, changedtick: integer?, lines: integer?, error: string? }
function M.reload(bufnr, force)
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

  vim.api.nvim_buf_call(bufnr, function()
    vim.cmd("edit!")
  end)

  return {
    ok = true,
    modified = vim.bo[bufnr].modified,
    changedtick = vim.api.nvim_buf_get_changedtick(bufnr),
    lines = vim.api.nvim_buf_line_count(bufnr),
  }
end

return M
