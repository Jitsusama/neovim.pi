# neovim.pi agent instructions

## What this is

A pi package that pairs pi sessions with neovim
sessions over a bidirectional msgpack-rpc protocol.
Three parts in one repo:

- **`doc/`** — canonical wire specification (markdown)
  plus `:help neovim-pi` tags. Nvim only treats
  `*.txt` as help files, so markdown lives here too.
- **`extensions/neovim-pi/`** + **`lib/`** — pi-side
  TypeScript: socket attach, capability negotiation,
  method registry, lifecycle, RPC dispatch. The lib is
  the public TS API other pi extensions consume.
- **`lua/neovim-pi/`** + **`plugin/`** + **`doc/`** —
  neovim Lua plugin: RPC client, registry, `pi://`
  buffer adapter, status cache. Ships zero defaults.

Everything lives at repo root. Both ecosystems' tools
find what they expect:

- Nvim plugin managers add the repo root to
  `runtimepath` — `plugin/`, `lua/`, `doc/` are picked
  up automatically.
- Pi resolves the `pi.extensions` path in
  `package.json` (`./extensions/neovim-pi`)
  and `package.json#exports` (`./lib`) for the public
  TS API. Mirrors `agentic-harness.pi`'s layout.

## Why one repo

The wire format, the pi-side registry and the nvim-side
dispatch all move together. Splitting them creates
version-drift risk. The conformance tests in
`tests/conformance/` need both implementations side by
side.

## What this is not

- **Not a UI toolkit.** Pi has its own TUI. Nvim has its
  own UI. The protocol is plumbing; the user's editor
  doesn't change.
- **Not opinionated.** No default keymaps, no autocmds,
  no subscriptions. Users opt in.
- **Not a one-way "pi controls nvim" channel.** Either
  side can register methods, initiate calls, emit events.

## Conventions

- TypeScript on the pi side. Lua on the nvim side. No
  build step on either.
- Pi extension follows the parent project's extension
  conventions (see `extensions/neovim-pi/README.md`
  for specifics).
- Lua plugin follows standard nvim plugin conventions
  (`plugin/` for bootstrap, `lua/neovim-pi/` for the
  public API).
- Lint with biome (TypeScript) and stylua (Lua).
  TypeScript: `npm run lint`.
- Conformance test vectors live in `tests/conformance/`
  as JSON files; both implementations run them.

## When working on the protocol

- Update `doc/protocol.md` first, then both
  implementations.
- Capability flags must be additive: new flags must not
  break old peers. A peer that doesn't advertise a flag
  simply doesn't use the feature.
- Wire-level breaking changes bump the major version.
  Within a major version, both implementations must
  remain compatible with the documented spec.

## When working on the pi extension

- Read `extensions/neovim-pi/README.md` for
  architectural conventions.
- The extension's domain logic (codecs, capability
  registry, types) lives in `pi/lib/` so other pi
  extensions and packages can import it without
  loading the companion extension.
- Caching the nvim client belongs in the extension;
  the lib stays pure.

## When working on the nvim plugin

- `plugin/neovim-pi.lua` is the **only** file allowed
  to run on plugin load. It must set up nothing —
  literally just ensure the lua module is reachable.
- All public API lives under `require("neovim-pi")`.
- Defaults are opt-in via `setup({ ... })`.
- `BufReadCmd` for `pi://` buffers is registered only
  when `setup` is called with `buffers.enable = true`
  (default for the pr-workflow integration).
- `doc/neovim-pi.txt` provides `:help` tags (separate
  from the markdown spec files). Run
  `:helptags doc/` after edits to refresh tags.
- Lint Lua with `stylua` (not enforced yet — add to
  CI before first tag).

## Design principles (recap)

1. Two peers, not client and server.
2. Capability negotiation.
3. Domain language (pi terms ↔ nvim terms).
4. Pi can usurp; nvim is sovereign. The user wins.
5. No defaults. Users compose.
