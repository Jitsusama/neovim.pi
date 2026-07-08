-- Minimal init for headless test runs.
--
-- Loads plenary and the neovim-pi plugin onto runtimepath
-- and sets cpath so `require("neovim-pi.*")` works. Used
-- by both the test runner and `scripts/lua-test.sh`.
--
-- Isolation matters here: a user with the plugin installed
-- system-wide (home-manager, lazy, packer, pack/start, ...)
-- would otherwise see their installed copy shadow the
-- working tree. We clear packpath and runtimepath down to
-- the working tree plus plenary so the tests always exercise
-- the source under edit.

local cwd = vim.fn.getcwd()

vim.opt.packpath = ""
vim.opt.runtimepath = cwd

-- Restore nvim's own runtime (not user plugins) so core Lua
-- modules loaded lazily off the runtimepath resolve: vim.uri,
-- vim.lsp and friends. Isolation is about keeping the user's
-- installed plugins from shadowing the working tree, not about
-- dropping nvim's bundled runtime.
if vim.env.VIMRUNTIME and vim.env.VIMRUNTIME ~= "" then
  vim.opt.runtimepath:append(vim.env.VIMRUNTIME)
end

-- Drop any neovim-pi modules that nvim's site pack loader
-- may have eagerly cached before this init ran.
for name in pairs(package.loaded) do
  if name:match("^neovim%-pi") then
    package.loaded[name] = nil
  end
end

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
