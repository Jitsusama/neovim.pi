# neovim-pi

Pi extension that pairs the pi session with a neovim
session over msgpack-rpc.

## What it does

- On `session_start`, looks for a neovim socket
  (`$NVIM_LISTEN_ADDRESS`, then a configurable XDG
  path) and attaches.
- Exchanges a capability handshake with the nvim peer.
- Registers method handlers under the `pi.*` namespace
  for nvim to call back into.
- Exposes `pi.registerTool("nvim.*")` so the agent can
  drive nvim from inside pi (open buffers, set
  extmarks, etc.).
- Streams status fragments and watches nvim's cursor
  and buffer state.
- Tears down cleanly on `session_shutdown` and
  reconnects after `/reload`.

## What it is not

- Not a TUI replacement. Pi keeps its own TUI; nvim
  keeps its own UI. The companion is plumbing.
- Not coupled to pr-workflow. Other pi extensions can
  use the same registry to add their own RPC methods.

## Layout

```
neovim-pi/
├── README.md          # this file
├── index.ts           # registration + lifecycle wiring
└── src/
    ├── attach.ts      # socket discovery + connection
    ├── handshake.ts   # capability negotiation
    ├── registry.ts    # method dispatch (nvim → pi)
    ├── client.ts      # cached NeovimClient wrapper
    ├── tools.ts       # pi tools that drive nvim
    ├── status.ts      # status fragment composition
    └── logger.ts      # neovim-package logger override
```

Cross-extension types and codecs live in
`../../lib/` so any pi extension can build on the
companion without depending on this directory.

## Conventions

- `index.ts` is registration only. Declare state, wire
  events, register tools, then delegate to functions
  in `src/`.
- Each `src/*.ts` file owns one responsibility.
- The npm `neovim` package monkey-patches `console`.
  `src/logger.ts` passes a custom logger to `attach()`
  to opt out.
- Cache the `NeovimClient` in `src/client.ts`. Close
  on `session_shutdown`. Reconnect on next
  `session_start`.
- Lint clean: `npm run lint` from the repo root.

## Dependencies

`neovim` (npm) is the only runtime dep. Pi provides
the rest via `@earendil-works/pi-coding-agent`.
