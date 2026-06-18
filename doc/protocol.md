# neovim-pi protocol

A bidirectional msgpack-rpc protocol that pairs a pi
session with a neovim session. This document is the
contract. Anything not specified here is not part of
the protocol.

## Wire

- Transport: a single Unix domain socket, full-duplex,
  msgpack-rpc (the same protocol nvim itself speaks).
- Encoding: msgpack v5.
- Lifecycle: pi initiates the connection. Either side
  can close it.

## Direction

The protocol is symmetric. Either peer can:

- Register methods.
- Issue requests (`rpcrequest`).
- Send notifications (`rpcnotify`).
- Emit events.

Conceptually:

- **pi methods** speak in pi terms (`pi.session.get`,
  `pi.tool.invoke`).
- **nvim methods** speak in nvim terms
  (`nvim_buf_open`, `nvim_buf_set_extmark`) plus a thin
  plugin facade (`pi.buffer.diff`, `pi.slot.show`).

To keep the channel registration count down, all
`pi.*` methods route through a single dispatcher named
`pi.dispatch`. The first argument is the method name;
the rest are method arguments.

```
nvim → pi : rpcrequest(pi_chan, "pi.dispatch", "session.get", {})
pi → nvim : nvim_exec_lua("return require('neovim-pi.buffer').open(...)", {uri, focus})
```

## Handshake

Right after attach, pi calls
`nvim_exec_lua("return require('neovim-pi.handshake').exchange(...)", {version, caps})`.
The neovim side records pi's info and returns its own:

```msgpack
{
  version: "0.1.0",
  capabilities: ["nvim.buffer.open", "nvim.buffer.markStale", ...]
}
```

Versions are SemVer. Within the same major version,
both implementations remain compatible. Major-version
bumps break compatibility.

## Capabilities

Capability flags are additive feature names. A peer
that doesn't advertise a flag simply doesn't use the
feature. See [capabilities.md](capabilities.md) for
the full catalogue.

### pi-side capabilities (v0.1.0)

| Flag | Meaning |
|---|---|
| `pi.session.get` | Return current session state (id, model, mode). |
| `pi.session.subscribe` | Stream session events (turn start/end, status). |
| `pi.tool.list` | List registered tool names. |
| `pi.tool.invoke` | Call a registered tool with typed args. |
| `pi.status.subscribe` | Subscribe to the composed status fragment. |
| `pi.prompt.append` | Append text to pi's input editor. |
| `pi.buffer.uri.resolve` | Resolve a `pi://` URI to buffer content. |

### nvim-side capabilities (v0.1.0)

| Flag | Meaning |
|---|---|
| `nvim.buffer.open` | Open a `pi://` URI as a buffer. |
| `nvim.buffer.markStale` | Flag a buffer as stale (pi disconnected). |
| `nvim.cursor.set` | Move the cursor in a window pi owns (or the named window). |
| `nvim.extmark.set` | Place an extmark (highlight, virtual text). |
| `nvim.status.publish` | Render pi status fragments somewhere. |

## `pi://` URI scheme

A virtual buffer scheme owned by the pi peer. The pi
side resolves URIs to content; the nvim side displays
them read-only.

```
pi://pr/<host>/<owner>/<repo>/<number>
pi://pr/<host>/<owner>/<repo>/<number>/files
pi://pr/<host>/<owner>/<repo>/<number>/diff
pi://pr/<host>/<owner>/<repo>/<number>/threads
pi://pr/<host>/<owner>/<repo>/<number>/thread/<id>
pi://stack/<host>/<owner>/<repo>/<rootNumber>
pi://review/<runId>/findings
pi://review/<runId>/finding/<id>
pi://local/<scope>/<path>
```

The full URI catalogue and per-buffer behaviours live
in the pr-workflow design docs. The protocol itself
just defines the resolver contract:

```
pi.buffer.uri.resolve(uri) → { lines: string[], filetype?: string, cursor?: [line, col] }
```

## Cross-package handler registration

The pi-side method registry lives in the neovim-pi
extension. Other pi extensions can't import it because
pi loads packages with isolated module roots. They use
the `pi.events` bus instead.

Three events form the contract:

```
neovim-pi:register-handler { method: string, handler: Handler }
neovim-pi:remove-handler   { method: string }
neovim-pi:ready            (no payload)
```

Where `Handler = (args: unknown[]) => unknown | Promise<unknown>`.

Neovim-pi subscribes to register and remove events at
extension load. It emits `ready` once subscriptions are
wired. The convention for callers is:

1. Emit `register-handler` once at your own extension
   init. This covers the case where neovim-pi loaded
   first.
2. Also subscribe to `ready` and re-emit on receipt.
   This covers the case where neovim-pi loads after
   you did.

Malformed payloads are dropped silently. Last
registration wins, mirroring `addMethod`'s semantics.
Removal is symmetric.

This bridge is the only sanctioned way for a separate
pi package to extend the registry. Bundled extensions
inside the neovim-pi package itself may call `addMethod`
directly from `lib/index.ts`.

## Buffer lifecycle

1. pi calls `nvim.buffer.open(uri, focus)`.
2. nvim creates the buffer, sets `buftype=nowrite`,
   `bufhidden=wipe`, `modifiable=false`, then calls
   `pi.buffer.uri.resolve(uri)` to fill it.
3. nvim fires `User NeovimPiBufferLoaded { uri, bufnr }`
   so user autocmds can attach.
4. When pi disconnects, nvim sets
   `b.neovim_pi_stale = true` on every `pi://` buffer.
5. When pi reconnects, the buffer state is rebuilt on
   demand.

## Disconnect semantics

- Either side can drop the socket at any time. The
  other side detects this and degrades gracefully.
- pi-side: cached `NeovimClient` becomes null; tool
  calls return a clear "nvim is not attached" error;
  the agent prompts the user to attach.
- nvim-side: the pi channel id is cleared; existing
  `pi://` buffers are marked stale; new buffer reads
  show the error inline.

## Conformance tests

Both implementations run the test vectors in
`/tests/conformance/` at the repo root. Each vector is
a small JSON file specifying a sequence of frames in
both directions and the expected reply shape. A
non-reference peer (an emacs plugin, a CLI tool) can
use the same vectors to verify spec compliance.

## What is not in the protocol

- A UI toolkit. Pi has its own TUI; nvim has its own
  UI. Each side renders however it likes.
- A keymap library. The nvim plugin ships zero
  defaults; users compose their own.
- A subscription database. Subscriptions are
  short-lived: a peer asks, the other peer streams
  notifications until the channel closes.
- A retry / backoff policy. Connection management is
  per-implementation.
