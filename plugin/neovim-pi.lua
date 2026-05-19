-- neovim-pi bootstrap.
--
-- This file runs once when the plugin loads. By design,
-- it sets up nothing. No autocmds, no commands, no
-- keymaps, no buffer types. All wiring happens through
-- explicit `require("neovim-pi").setup({ ... })`.
--
-- The single guard below prevents double-loading when
-- the plugin is sourced more than once.

if vim.g.loaded_neovim_pi == 1 then
  return
end
vim.g.loaded_neovim_pi = 1
