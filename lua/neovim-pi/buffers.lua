-- Buffer-list awareness.
--
-- Distinct from `buffer.lua`, which is the read-only `pi://`
-- virtual-buffer adapter. This module reports and manages the
-- editor's real buffers so the agent can see what is open,
-- including buffers loaded but not shown in any window.

local M = {}

local owned = require("neovim-pi.owned")

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

return M
