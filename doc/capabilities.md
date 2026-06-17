# Capabilities catalogue

Capability flags are the unit of feature negotiation
between peers. Each flag is additive: a peer that
doesn't advertise it is assumed not to support it. The
other side checks before relying.

This catalogue is the canonical list. New flags land
here first, then in both reference implementations.

## Versioning

Within a major version (e.g. `0.x`), flags are
additive: adding a flag is a minor bump; removing or
changing the semantics of a flag is a major bump. A
peer that doesn't recognise a flag silently ignores
it.

## pi-side capabilities

### `pi.session.get`

Returns the current session state.

```
pi.session.get() → {
  id: string,
  model: string,
  mode: "interactive" | "json",
  turn: number,
}
```

### `pi.session.subscribe`

Subscribes to session events. Streams notifications
until the channel closes or the subscription is
cancelled.

Events:

- `turn.start { turn: number, prompt: string }`
- `turn.end { turn: number, success: boolean }`
- `tool.call { id: string, name: string }`
- `tool.result { id: string, success: boolean }`
- `status.update { namespace: string, text: string }`

### `pi.tool.list`

```
pi.tool.list() → string[]
```

Returns the names of registered tools.

### `pi.tool.invoke`

```
pi.tool.invoke(name: string, params: any) → {
  content: { type: string, text: string }[],
  details: any,
}
```

Calls a registered pi tool with typed parameters.
Tools that prompt the user run as if the user invoked
them.

### `pi.status.subscribe`

```
pi.status.subscribe() → stream of { composed: string }
```

Subscribe to composed status fragment changes.

### `pi.prompt.append`

```
pi.prompt.append(text: string) → void
```

Append text to pi's input editor without submitting.
The user reviews and submits manually.

### `pi.buffer.uri.resolve`

```
pi.buffer.uri.resolve(uri: string) → {
  lines: string[],
  filetype?: string,
  cursor?: [line: number, col: number],
}
```

Resolve a `pi://` URI to renderable buffer content.

## nvim-side capabilities

### `nvim.buffer.open`

```
nvim.buffer.open(uri: string, focus: boolean) → bufnr
```

Open a `pi://` URI as a buffer. When `focus` is true,
move the user's window to it. Returns the new bufnr.

### `nvim.buffer.close`

```
nvim.buffer.close(uri: string) → boolean
```

Close a `pi://` buffer. Returns true if it was open.

### `nvim.buffer.markStale`

```
nvim.buffer.markStale(uri: string) → void
```

Mark a buffer as stale (pi has disconnected). The
plugin sets `b.neovim_pi_stale = true`; the user's
statusline can pick it up.

### `nvim.buffer.isModified`

```
nvim.buffer.isModified(path: string) → boolean
```

True when any buffer pointing at this path has
unsaved changes. Used by the fix loop to detect
conflicts before writing.

### `nvim.buffer.reload`

```
nvim.buffer.reload(path: string) → void
```

Force-reload any buffer pointing at `path` (`edit!`).
Used after the agent commits a fix.

### `nvim.window.cursor.set`

```
nvim.window.cursor.set(win: number, line: number, col: number) → void
```

Move the cursor in a window. `win` is a window handle,
or 0 for the current window. `line` is 1-indexed;
`col` is a 0-indexed byte offset and is clamped to the
line length so an out-of-range column never errors. pi
targets a window it owns; this does not take over the
user's focused window unless pi passes that window's
handle explicitly.

### `nvim.extmark.set`

```
nvim.extmark.set(bufnr: number, startRow: number, startCol: number, endRow: number, endCol: number, hlGroup: string) → number
```

Highlight a range with an extmark in neovim-pi's own
namespace and return the extmark id. Rows and columns
are 0-indexed and the end is exclusive. The single
namespace lets `nvim.extmark.clear` remove pi's marks
without touching the user's (LSP, diagnostics, other
plugins).

### `nvim.extmark.clear`

```
nvim.extmark.clear(bufnr: number) → void
```

Remove every neovim-pi extmark in a buffer. Pairs with
`nvim.extmark.set` to flash an edit highlight and then
clear it.

### `nvim.status.publish`

```
nvim.status.publish(composed: string) → void
```

Receive a composed pi status fragment. The plugin
doesn't render it; user config can pull from
`require("neovim-pi").status()` to display in
statusline or winbar.
