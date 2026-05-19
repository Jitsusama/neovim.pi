-- Luacheck config for the neovim-pi plugin.
--
-- The plugin runs inside neovim, so we tell luacheck
-- which globals are provided by the host. The standard
-- "lua51" library plus nvim's `vim` table covers
-- everything we touch.

std = "lua51"
cache = true

read_globals = {
  "assert",
}

-- The `vim` table is mutable at runtime (buffer-local
-- options like `vim.bo[buf].modified` are assignments,
-- not table writes). Treat it as a regular global so
-- those don't get flagged.
globals = {
  "vim",
}

-- Test specs use the busted DSL (`describe`, `it`,
-- `before_each`, etc.) which plenary injects into the
-- environment at run time.
files["tests/lua"] = {
  read_globals = {
    "describe",
    "it",
    "before_each",
    "after_each",
    "setup",
    "teardown",
    "pending",
  },
}

-- Don't lint vendored dependencies if any ever land
-- here in CI bootstrap.
exclude_files = {
  ".deps/",
  "node_modules/",
}

-- Reasonable defaults: warn on unused args (we use `_`
-- for ignored ones), keep line length under control,
-- but don't flag long string literals.
max_line_length = 120
ignore = {
  "212/_.*",  -- unused arg starting with underscore is fine
  "213/_.*",  -- unused loop var starting with underscore is fine
}
