-- Extmark highlights.
--
-- Backs the `nvim.extmark.set` and `nvim.extmark.clear`
-- capabilities. All neovim-pi extmarks live in a single
-- namespace so a clear can wipe pi's marks without touching
-- the user's own (LSP, diagnostics, other plugins).

local M = {}

local ns = vim.api.nvim_create_namespace("neovim-pi")

--- The namespace neovim-pi places its extmarks in.
function M.namespace()
  return ns
end

--- Highlight a range with an extmark and return its id.
---
--- Rows and columns are 0-indexed; the end is exclusive. An
--- extmark with no end range does not highlight anything, so
--- a highlight always carries an explicit end_row/end_col.
---@param bufnr integer
---@param start_row integer
---@param start_col integer
---@param end_row integer
---@param end_col integer
---@param hl_group string
---@return integer extmark id
function M.set(bufnr, start_row, start_col, end_row, end_col, hl_group)
  return vim.api.nvim_buf_set_extmark(bufnr, ns, start_row, start_col, {
    end_row = end_row,
    end_col = end_col,
    hl_group = hl_group,
  })
end

--- Remove every neovim-pi extmark in a buffer.
---@param bufnr integer
function M.clear(bufnr)
  vim.api.nvim_buf_clear_namespace(bufnr, ns, 0, -1)
end

return M
