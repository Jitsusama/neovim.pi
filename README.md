# neovim.pi

A pi extension and neovim plugin that pair pi sessions
with neovim sessions over msgpack-rpc. Two peer programs,
one bidirectional channel, capability negotiation in both
directions.

This is a **public protocol**, not a closed product. The
spec lives alongside two reference implementations (pi
extension + nvim plugin). Anyone can write their own
peer (an emacs plugin, a different pi config, a CLI test
harness) that speaks the same wire.

## What it does

When pi pairs with nvim, **pi can**:

- Open `pi://` URIs as nvim buffers (read-only by default).
- Show the user's code in their own editor instead of an
  inline TUI viewer.
- Jump the cursor, set extmarks, push diagnostics.
- Receive keymap signals from nvim back into pi.
- Stream cursor and buffer state so the agent knows what
  the user is looking at.

And **nvim can**:

- Query pi for session state, tool calls, conversation
  history.
- Invoke any registered pi tool.
- Subscribe to pi's status channels.
- Send prose to pi's prompt buffer.
- Detach cleanly without locking either side.

Nothing is wired by default. The plugin ships zero
keymaps, zero autocmds, zero subscriptions. Users (or
other pi extensions) compose the integration they want.

## Install

### pi side

`neovim-pi` ships inside this repo as a pi extension.
Install via `pi install`:

```bash
pi install git:github.com/Jitsusama/neovim.pi
```

Or vendor the path into your `~/.pi/settings.json`:

```json
{
  "packages": ["git:github.com/Jitsusama/neovim.pi@main"]
}
```

### nvim side

**`lazy.nvim`:**

```lua
{
  "Jitsusama/neovim.pi",
  config = function()
    require("neovim-pi").setup({
      -- Pi discovers nvim via per-pid sockets under the
      -- pi state dir; the default below matches what pi
      -- looks for.
      listen = (vim.env.XDG_RUNTIME_DIR or vim.fn.expand("~/.local/state/pi"))
        .. "/nvim-" .. vim.fn.getpid() .. ".sock",
      -- Opt-in: register the `pi://` BufReadCmd.
      buffers = { enable = true },
      -- Opt-in: register `:PiStatus` / `:PiDetach`.
      commands = { enable = true },
    })
  end,
}
```

**`packer.nvim`:**

```lua
use({
  "Jitsusama/neovim.pi",
  config = function()
    require("neovim-pi").setup({
      buffers = { enable = true },
      commands = { enable = true },
    })
  end,
})
```

**`paq-nvim`** and any manual `runtimepath` setup work
too; the plugin has no build step. For `:help` access,
run `:helptags ALL` after install.

`setup()` defaults to a per-pid socket under
`$XDG_RUNTIME_DIR` (or `~/.local/state/pi` on macOS), so
each nvim instance gets a unique listener and pi can
disambiguate them in the picker. Pass an explicit
`listen` only if you want to override.

## Pairing

Pi never auto-attaches. The agent calls
`nvim_attach` on your behalf, which:

1. **Lists candidate nvims** by scanning the pi state
   dir for `nvim-*.sock` files. Each candidate is
   labelled with its working directory (read from the
   `.cwd` sidecar the plugin writes) plus pid and age.
2. **Auto-picks** when only one candidate is running.
3. **Prompts you** when multiple nvims are running. You
   pick the one you want by project.
4. **Remembers the pairing** for the session. A
   `/reload` restores the same nvim if it's still
   alive; if it died, pi forgets and starts fresh.

The status line shows a single nerd-font vi glyph:
green when paired, muted when not.

## Testing

Both halves have test suites. Lint and tests run on
every push via GitHub Actions.

```sh
pnpm test           # both halves
pnpm test:ts        # vitest specs for the pi extension
pnpm test:lua       # plenary.busted specs for the nvim plugin
pnpm lint           # biome (TS) + luacheck + stylua (Lua)
pnpm helptags       # regenerate doc/tags
```

See [`AGENTS.md`](AGENTS.md) for development notes,
code style, lint and test requirements.

## Structure

```
neovim.pi/
├── doc/                       # all docs (nvim `:help` + markdown)
│   ├── neovim-pi.txt          # `:help neovim-pi` tags
│   ├── protocol.md            # canonical wire spec
│   ├── capabilities.md        # capability catalogue
│   └── neovim-plugin.md       # plugin install + Lua API
├── plugin/                    # auto-sourced by nvim (load guard only)
│   └── neovim-pi.lua
├── lua/neovim-pi/             # `require("neovim-pi")` entry points
│   ├── init.lua               # setup() and public API
│   ├── rpc.lua                # socket listener + RPC client
│   ├── handshake.lua          # capability exchange
│   ├── buffer.lua             # `pi://` BufReadCmd adapter
│   └── commands.lua           # `:PiStatus` / `:PiDetach`
├── extensions/neovim-pi/      # pi extension (TS)
├── lib/                       # public TS API for other pi packages
└── tests/
    ├── ts/                    # vitest
    ├── lua/                   # plenary.busted
    └── conformance/           # wire vectors both sides run
```

Nvim's `:helptags doc/` only scans `*.txt` for help
tags, so the markdown protocol spec sits comfortably
in the same directory.

The layout follows both ecosystems' conventions:

- **Nvim** plugin managers add the repo root to
  `runtimepath` and look for `plugin/`, `lua/`, `doc/`
  there. ✓
- **Pi** reads the `pi` key in `package.json` and
  resolves extension paths relative to the repo root
  (here, `./extensions/neovim-pi`). Mirrors the
  `extensions/` + `lib/` pattern in
  `agentic-harness.pi`. ✓

## Design principles

1. **Two peers, not client and server.** Either side can
   initiate requests, register methods, emit events.
2. **Capability negotiation.** Each side advertises what
   it can do at handshake. Missing capabilities degrade
   gracefully.
3. **Domain language.** Pi methods speak in pi terms
   (`pi.session.get`, `pi.tool.invoke`). Nvim methods
   are nvim's existing API (`nvim_buf_open`,
   `nvim_buf_set_extmark`) plus a thin plugin facade.
4. **Pi can usurp; nvim is sovereign.** Pi can open a
   buffer in front of the user; the user can
   immediately move, close, undo, ignore.
5. **No defaults.** No autocmds. No keymaps. No
   subscriptions. Users opt in.

For the full spec, read [doc/protocol.md](doc/protocol.md).

## Status

Reference implementations are in active development. The
protocol is still settling. Expect breaking changes on
`main` until a tagged release.

## License

MIT.
