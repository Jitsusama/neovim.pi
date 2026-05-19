# neovim.pi agent instructions

Working notes for anyone (human or model) editing this
repo. Read this first; the README is for users.

## What this is

A pi package that pairs pi sessions with neovim sessions
over a bidirectional msgpack-rpc protocol. Three parts in
one repo:

- **`doc/`** — canonical wire specification (markdown)
  plus `:help neovim-pi` tags. Nvim only treats `*.txt`
  as help files, so markdown lives here too.
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
- Pi resolves the `pi.extensions` path in `package.json`
  (`./extensions/neovim-pi`) and `package.json#exports`
  (`./lib`) for the public TS API. Mirrors
  `agentic-harness.pi`'s layout.

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
  no subscriptions. Users opt in via `setup()`.
- **Not a one-way "pi controls nvim" channel.** Either
  side can register methods, initiate calls, emit events.

## Design principles

1. **Two peers, not client and server.** Either side can
   initiate requests, register methods, emit events.
2. **Capability negotiation.** Each side advertises what
   it can do at handshake. Missing capabilities degrade
   gracefully.
3. **Domain language.** Pi methods speak in pi terms
   (`pi.session.get`, `pi.tool.invoke`). Nvim methods are
   nvim's existing API (`nvim_buf_open`, etc.) plus a
   thin plugin facade.
4. **Pi can usurp; nvim is sovereign.** Pi can open a
   buffer in front of the user; the user can immediately
   move, close, undo, ignore.
5. **No defaults.** Users compose the integration they
   want via `setup({ ... })`.

## Repository layout

```
neovim.pi/
├── extensions/neovim-pi/     # pi-side extension (TS)
│   ├── index.ts              # registration + wiring only
│   └── src/                  # attach, discovery, handshake,
│                             # registry, lifecycle-tools, etc.
├── lib/                      # public TS surface for other
│                             # pi packages
├── lua/neovim-pi/            # nvim-side plugin (Lua)
│   ├── init.lua              # public `require("neovim-pi")` API
│   ├── rpc.lua               # socket + RPC client
│   ├── handshake.lua         # capability exchange
│   ├── buffer.lua            # `pi://` BufReadCmd
│   └── commands.lua          # `:PiStatus` / `:PiDetach`
├── plugin/                   # nvim bootstrap (no-op guard)
├── doc/                      # `:help` text + protocol spec
├── tests/
│   ├── ts/                   # vitest specs (TS half)
│   ├── lua/                  # plenary.busted specs (Lua half)
│   └── conformance/          # cross-language wire vectors
├── scripts/                  # CI helpers (lua-test.sh)
└── .github/workflows/ci.yml  # CI: lint + test + helptags
```

## Code style

### TypeScript

- **Biome enforces formatting and linting.** No
  prettier, no ESLint, no separate formatter. Tabs for
  indentation; double quotes; trailing commas; long
  semicolons. Run `pnpm lint:ts:fix` then `pnpm lint:ts`.
- **No build step.** Pi compiles TS at runtime. Don't
  add a `tsc` build or bundler.
- **Imports**: pi types come from `@earendil-works/pi-coding-agent`;
  do not import pi's own runtime packages — they are
  injected at extension load time.
- **`typebox` is vendored by pi at runtime.** Devs need
  it installed locally for vitest only (it's in
  `devDependencies`). Don't import from
  `@sinclair/typebox`.
- **Error handling**: throw `Error` with a sentence
  starting lowercase ("no nvim paired with this pi
  session ..."). Tools that talk to the user surface
  the message verbatim.
- **Async first.** No callbacks where promises work.

### Lua

- **`stylua` enforces formatting.** Two-space indent,
  double quotes, LF endings. Run `pnpm lint:lua:fix`.
- **`luacheck` enforces correctness.** Warnings are
  treated as errors in CI. The config in `.luacheckrc`
  allows the standard nvim globals and busted DSL.
- **Buffer-local options use `vim.bo[buf].x = ...`**,
  not `vim.api.nvim_buf_set_option` (that's deprecated).
- **No `print()` in committed code.** Use
  `vim.notify(msg, vim.log.levels.INFO)`; tests can
  capture it.
- **Module shape**: every Lua module is a table with
  named functions; no metatables, no inheritance. Local
  helpers are file-local `local function name()`.

### Prose

Canadian English in all user-facing strings (comments,
errors, docs, help). No em-dashes; prefer commas, brackets
or sentence breaks.

## Linting

```sh
pnpm lint       # both halves
pnpm lint:fix   # autofix both halves
pnpm lint:ts    # just biome
pnpm lint:lua   # just luacheck + stylua --check
```

CI runs `pnpm lint` on every push and PR. Lint failures
block merge.

## Testing

Both halves have automated test suites. Tests are
required for every change that touches behaviour;
pure-refactor PRs run the existing suite green.

```sh
pnpm test        # both, in sequence
pnpm test:ts     # vitest specs for the pi extension
pnpm test:lua    # plenary.busted specs for the nvim plugin
```

### Test layout

- `tests/ts/*.test.ts` — vitest specs for the TS
  extension. Mock `NeovimClient` and the pi
  `ExtensionAPI`; no real socket required, except
  `discovery.test.ts` which exercises real Unix sockets
  under `tmpdir`.
- `tests/lua/*_spec.lua` — plenary.busted specs that
  run under headless nvim via `scripts/lua-test.sh`.
  Plenary clones to `.deps/plenary.nvim` automatically
  if missing.
- `tests/conformance/*.json` — cross-language wire
  vectors. Each side reads the same JSON and asserts
  the documented contract. Drift in either
  implementation fails CI.

### What to test

Tests assert **functional behaviour through public
APIs**, never implementation. Concretely:

- **Do** test round-trips: "after I `rememberPairing(X)`,
  `lastPairing()` returns X."
- **Do** test wire contracts: "a handler returning
  `{lines: [...]}` produces that exact shape on the wire."
- **Do** test observable side effects: "after `listen()`,
  the socket file exists on disk."
- **Don't** test internal call shapes: "`appendEntry` was
  called with type X and data Y." If the storage format
  changes, the test should not move.
- **Don't** test absence of internal state: "this function
  doesn't cache." Caching is an implementation choice.
- **Don't** test seeded helpers that aren't documented
  public protocol (e.g. internal debug methods).

If a test would still pass after a legitimate refactor
that preserves the observable behaviour, it's a good
test. If it would break, it's testing internals.

### Test isolation (Lua)

`tests/lua/minimal_init.lua` clears `packpath` and pins
`runtimepath` to the working tree before each test runs.
This matters because nvim auto-loads `pack/start/*` at
startup — without isolation, a copy of the plugin
installed system-wide (via home-manager, lazy.nvim,
etc.) would shadow the working tree and tests would
silently exercise the wrong code.

If a Lua test mysteriously passes for the wrong reason,
check `debug.getinfo(M.f, "S").source` to confirm which
file the function actually came from.

### Test isolation (TS)

Vitest runs in a fresh module graph per test file. Tests
that touch process env (`XDG_RUNTIME_DIR`) restore it in
`afterEach`. Tests that build `tmpdir` sockets close
them in `afterEach`. Concurrent vitest workers each get
their own tmp dir.

## CI gates

Every push and PR runs five jobs in parallel:

1. **lint-ts** — `pnpm lint:ts` (biome)
2. **lint-lua** — `luacheck` + `stylua --check`
3. **test-ts** — `pnpm test:ts` (vitest)
4. **test-lua** — `pnpm test:lua` (plenary.busted under
   headless nvim)
5. **helptags** — `nvim --headless -c "helptags doc"`
   and verifies `doc/tags` is non-empty

A merge requires all five green.

## When working on the protocol

- Update `doc/protocol.md` first, then both
  implementations.
- Capability flags must be additive: new flags must not
  break old peers. A peer that doesn't advertise a flag
  simply doesn't use the feature.
- Add a conformance vector under `tests/conformance/`
  for any new flow. Make sure both halves consume it.
- Wire-level breaking changes bump the major protocol
  version (`PROTOCOL_VERSION` in `handshake.ts` /
  `handshake.lua`). Within a major version, both
  implementations must remain compatible with the
  documented spec.

## When working on the pi extension

- Read `extensions/neovim-pi/index.ts` for the wiring
  story; substantive logic lives in `src/`.
- Domain logic (codecs, capability registry, types)
  lives in `lib/` so other pi extensions and packages
  can import it without loading the companion
  extension.
- **Caching the nvim client belongs in the extension**;
  the lib stays pure. Auth functions are stateless;
  the extension wraps in a session-lifetime cache.
- Tools the agent calls go through `registerTool`; the
  call/result render handlers stay inline with the
  registration because they're one unit.

## When working on the nvim plugin

- `plugin/neovim-pi.lua` is the **only** file allowed
  to run on plugin load. It must set up nothing —
  literally just a single load guard. No autocmds, no
  commands, no keymaps.
- All public API lives under `require("neovim-pi")`.
- Defaults are opt-in via `setup({ ... })`. Each call
  to `setup()` starts from the DEFAULTS table and
  applies user opts on top — there is no merge across
  calls. Anything you omit reverts.
- `BufReadCmd` for `pi://` is registered only when
  `setup({ buffers = { enable = true } })`. User
  commands `:PiStatus` / `:PiDetach` are similarly
  gated behind `commands = { enable = true }`.
- The RPC listener writes a `.cwd` sidecar next to its
  socket so pi's multi-nvim picker can show project
  context. Keep this in sync with cwd via
  `DirChanged`.
- `doc/neovim-pi.txt` provides `:help` tags. Run
  `pnpm helptags` after edits; CI verifies tags
  generate cleanly.

## Common gotchas

- **macOS tempname symlinks**: `vim.fn.tempname()`
  returns `/var/folders/.../X/0` but the resolved path
  is `/private/var/folders/.../X/0`. Buffer tests must
  read back via `nvim_buf_get_name(bufnr)` to compare
  the resolved form.
- **Site pack shadow**: see "Test isolation (Lua)"
  above. The first thing to check when a Lua test
  behaves unexpectedly is whether it's even running
  the file you think it is.
- **`PlenaryBustedFile` does NOT propagate `minimal_init`**.
  Use `PlenaryBustedDirectory tests/lua {minimal_init = '...'}`
  via `scripts/lua-test.sh`. Single-file invocations
  for debugging bypass test isolation and may run
  against a system-installed copy of the plugin.
- **`resp.send(value, isError?)`** — the npm `neovim`
  package's RPC response object takes the value first
  and an `isError` boolean second. Calling
  `resp.send(error)` looks correct but sends the error
  as a result.
- **`setup()` is replace, not merge**. If a test or
  caller turns on `buffers.enable = true` and the next
  `setup()` call wants it off, it has to explicitly
  pass `buffers = { enable = false }` or omit the
  whole `buffers` key (which reverts to default).

## Doing work in this repo

1. Read `AGENTS.md` (this file).
2. Run `pnpm test` and `pnpm lint` to confirm a clean
   baseline before changing anything.
3. Make changes. Add tests that exercise the new
   behaviour through the public API.
4. Run `pnpm lint:fix` then `pnpm lint` to confirm
   format + lint clean.
5. Run `pnpm test` to confirm everything still passes.
6. If you touched `doc/`, run `pnpm helptags` and
   confirm tags generate cleanly.
7. Commit. Use conventional commit prefixes (`feat:`,
   `fix:`, `refactor:`, `test:`, `chore:`, `docs:`).
8. Push and open a PR. CI must be green before merge.
