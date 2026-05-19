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

When attached, pi can:

- Open `pi://` URIs as nvim buffers (read-only by default).
- Show the user's code in their own editor instead of an
  inline TUI viewer.
- Jump the cursor, set extmarks, push diagnostics.
- Receive keymap signals from nvim back into pi.
- Stream cursor and buffer state so the agent knows what
  the user is looking at.

When attached, nvim can:

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

`neovim-pi` ships inside this repo as a pi
extension. Install via `pi install`:

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
      -- Listen on the XDG socket pi looks for by default.
      listen = vim.env.XDG_RUNTIME_DIR .. "/neovim-pi.sock",
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
    require("neovim-pi").setup({ listen = "/run/user/1000/neovim-pi.sock" })
  end,
})
```

**`paq-nvim`** and any manual `runtimepath` setup work
too; the plugin has no build step. For `:help` access,
run `:helptags ALL` after install.

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
│   ├── init.lua
│   ├── rpc.lua
│   ├── handshake.lua
│   ├── buffer.lua
│   └── commands.lua
├── extensions/                # pi extensions
│   └── neovim-pi/
├── lib/                       # shared TS API for other pi packages
│   └── index.ts
└── tests/
    └── conformance/           # test vectors both sides run
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
   (`pi.session.get`, `pi.tool.invoke`). Nvim methods are
   nvim's existing API (`nvim_buf_open`,
   `nvim_buf_set_extmark`) plus a thin plugin facade
   (`pi.buffer.diff`).
4. **Pi can usurp; nvim is sovereign.** Pi can open a
   buffer in front of the user; the user can immediately
   move, close, undo, ignore.
5. **No defaults.** No autocmds. No keymaps. No
   subscriptions. Users opt in.

For the full spec, read [doc/protocol.md](doc/protocol.md).

## Status

Reference implementations are in active development. The
protocol is still settling. Expect breaking changes on
`main` until a tagged release.

## License

MIT.
