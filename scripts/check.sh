#!/usr/bin/env bash
# Everything a change must pass before it merges, run locally:
# there is no CI. Lint both halves, run both test suites, and
# check that `:help` tags generate.
#
# luacheck and stylua come from PATH when they're there, and
# otherwise from nixpkgs through `nix shell`, so a machine
# with Nix needs nothing installed first.

set -euo pipefail

cd "$(dirname "$0")/.."

lua_tools=()
command -v luacheck >/dev/null || lua_tools+=(nixpkgs#lua51Packages.luacheck)
command -v stylua >/dev/null || lua_tools+=(nixpkgs#stylua)

echo "==> lint" >&2
pnpm lint:ts
if ((${#lua_tools[@]} > 0)); then
  nix shell "${lua_tools[@]}" -c pnpm lint:lua
else
  pnpm lint:lua
fi

echo "==> test" >&2
pnpm test

echo "==> helptags" >&2
pnpm helptags
test -s doc/tags || { echo "doc/tags is empty or missing" >&2; exit 1; }
