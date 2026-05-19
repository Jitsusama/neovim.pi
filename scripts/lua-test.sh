#!/usr/bin/env bash
# Run the lua test suite under headless nvim.
#
# Plenary's busted runner is the standard nvim plugin test
# harness. We look for plenary on the user's runtimepath or
# fall back to `.deps/plenary.nvim` (CI clones it there).

set -euo pipefail

cd "$(dirname "$0")/.."

# Bootstrap plenary into .deps/ when it's missing entirely
# (CI runs end up here; local devs typically already have
# plenary on their nvim rtp).
if [[ ! -d .deps/plenary.nvim ]] \
  && [[ ! -d "$HOME/.local/share/nvim/site/pack/hm/start/plenary.nvim" ]] \
  && [[ ! -d "$HOME/.local/share/nvim/site/pack/vendor/start/plenary.nvim" ]]; then
  echo "==> cloning plenary.nvim into .deps/" >&2
  mkdir -p .deps
  git clone --depth 1 https://github.com/nvim-lua/plenary.nvim .deps/plenary.nvim
fi

exec nvim --headless --noplugin \
  -u tests/lua/minimal_init.lua \
  -c "PlenaryBustedDirectory tests/lua {minimal_init = 'tests/lua/minimal_init.lua'}"
