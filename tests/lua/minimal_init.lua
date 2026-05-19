-- Minimal init for headless test runs.
--
-- Loads plenary and the neovim-pi plugin onto runtimepath
-- and sets cpath so `require("neovim-pi.*")` works. Used
-- by both the test runner and `scripts/lua-test.sh`.

local cwd = vim.fn.getcwd()

vim.opt.runtimepath:prepend(cwd)
vim.opt.runtimepath:append(vim.fn.stdpath("data") .. "/lazy/plenary.nvim")

-- Try common system locations for plenary (CI installs it
-- via the official action which places it under the runner
-- workspace).
for _, candidate in ipairs({
  cwd .. "/.deps/plenary.nvim",
  vim.fn.expand("~/.local/share/nvim/site/pack/hm/start/plenary.nvim"),
  vim.fn.expand("~/.local/share/nvim/site/pack/vendor/start/plenary.nvim"),
}) do
  if vim.fn.isdirectory(candidate) == 1 then
    vim.opt.runtimepath:append(candidate)
  end
end

vim.cmd("runtime plugin/plenary.vim")
