# Capabilities catalogue

Capability flags are the unit of feature negotiation
between peers. Each flag is additive: a peer that
doesn't advertise it is assumed not to support it. The
other side checks before relying.

This catalogue is the canonical list. New flags land
here first, then in both reference implementations.

## Versioning

Capability flags, not the protocol version, are the unit
of compatibility. Each flag is additive and negotiated on
its own: a peer that stops advertising a flag is treated
as not supporting it, so the other side degrades through
the same capability check it always runs, with no version
comparison involved. When a flag's shape or semantics
change, it is given a new name rather than mutated in
place, so the rename flows through that same negotiation
(an old peer asks for the old name, does not find it and
degrades) instead of silently mismatching under an
unchanged name.

The protocol version tracks the envelope the peers speak,
not the set of capabilities, and the handshake does not
gate compatibility on it. Pre-1.0 it carries no ceremony:
adding, removing or renaming a flag does not bump it.

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

### `nvim.buffer.markStale`

```
nvim.buffer.markStale(uri: string) → void
```

Mark a buffer as stale (pi has disconnected). The
plugin sets `b.neovim_pi_stale = true`; the user's
statusline can pick it up.

### `nvim.cursor.get`

```
nvim.cursor.get(win: number) → { win, bufnr, name, line, col, mode }
```

Report the live cursor position in a window (`win` is a
handle, or 0 for the current window). The read-side mirror
of `nvim.cursor.set`: it shares the 1-indexed line
and 0-indexed **byte** column convention, so a get then set
round-trips without translation. Note the column is a byte
offset, unlike the `nvim.text` range tools, which speak
character columns; translate before crossing between them.

### `nvim.cursor.set`

```
nvim.cursor.set(win: number, line: number, col: number) → void
```

Move the cursor in a window. `win` is a window handle,
or 0 for the current window. `line` is 1-indexed;
`col` is a 0-indexed byte offset and is clamped to the
line length so an out-of-range column never errors. pi
targets a window it owns; this does not take over the
user's focused window unless pi passes that window's
handle explicitly.

### `nvim.cursor.stream`

```
nvim.cursor.stream → push: cursor.moved({
  win, bufnr, name, line, col, mode, source
})
```

A push, not a request: nvim watches the human's cursor
through `CursorMoved`/`CursorMovedI` and notifies pi
with a debounced snapshot on every move, so pi knows
where the human is and whether they were just typing
without polling. The snapshot is tagged `source =
"human"`, a constant: nvim does not fire `CursorMoved`
for a programmatic `nvim_win_set_cursor` (`:h
CursorMoved` fires only on a move the human makes), and
pi edits in the windows it owns rather than the human's
focused window, so pi's own cursor work never echoes
into the stream. pi starts the stream on attach and
tears it down on detach.

### `nvim.cursor.selection.get`

```
nvim.cursor.selection.get(win: number) → {
  win, bufnr, kind, start: {line, col}, finish: {line, col}, text, empty
}
```

Report the human's visual selection in a window: its kind
(`v` charwise, `V` linewise, `b` blockwise), the start and
finish (1-indexed line, 0-indexed **byte** column,
inclusive end) and the selected text. The column unit is
bytes, matching `nvim.cursor.get`/`set`; the `nvim.text`
range tools speak character columns, so translate before
feeding a selection into them. It reads the live anchor and cursor while visual mode
is active, and the `'<`/`'>` marks once it ends, since
those marks lag a selection behind until visual mode
closes. `empty` is true when nothing has been selected.

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

### `nvim.file.open`

```
nvim.file.open(path: string, opts?: { mode?: "current" | "split" | "vsplit", line?: number, col?: number }) →
  { bufnr: number, path: string, lines: number, win: number }
```

Open a real file from disk into a window pi owns,
created lazily to the side of wherever the human is, so
the open never steals focus. `mode` places the file:
`current` (default) reuses pi's primary stage window,
while `split` and `vsplit` open a new pi-owned window
beside it. Optional `line` and `col` land the cursor
(`line` is 1-indexed, `col` a 0-indexed byte offset,
ignored without `line`). The buffer is editable and is
claimed in pi's ownership ledger. Returns the bufnr, the
resolved absolute path, the line count and the window it
opened in.

### `nvim.file.save`

```
nvim.file.save(bufnr: number) → { ok: boolean, modified: boolean, changedtick: number }
```

Write a stage buffer pi owns back to its file. Refuses
a buffer pi did not open. A format-on-save autocmd, if
the user has one, runs as part of the write and may
change the content.

### `nvim.file.reload`

```
nvim.file.reload(bufnr: number, force?: boolean) →
  { ok: true, modified, changedtick, lines }
  | { ok: false, modified?, error }
```

Reload a buffer pi owns from its file on disk: the
inverse of `save`, via `:edit!`. Refuses a buffer pi did
not open. Because `:edit!` silently discards unsaved
buffer changes, a modified buffer is a confirm trigger:
reload reports `modified: true` rather than discarding,
and `force` discards the edit and goes through. Returns
the post-reload changedtick and line count so the caller
can re-arm the edit path's conflict check.

### `nvim.text.getRange`

```
nvim.text.getRange(bufnr, startLine, startCol, endLine, endCol) → { text: string }
```

Read the text in a range. Lines are 1-indexed; columns
are 0-indexed character offsets, end-exclusive. The
character columns are translated to byte offsets
internally so multibyte text is read correctly.

### `nvim.text.setRange`

```
nvim.text.setRange(bufnr, startLine, startCol, endLine, endCol, replacement, expectedChangedtick?) →
  { ok: true, changedtick, endLine, endCol, lines }
  | { ok: false, error, conflict?, changedtick }
```

Replace a character range in a buffer pi owns, in the
same coordinate system as `getRange`. Refuses a buffer
pi did not open. When `expectedChangedtick` is given
and no longer matches, refuses without writing so a
stale view never clobbers a concurrent change. The
write is one undo step, and the new text is briefly
highlighted.

### `nvim.window.layout`

```
nvim.window.layout() → {
  current_win: number,
  stage_win: number | null,
  tabs: { tabnr: number, windows: {
    win: number, bufnr: number, name: string,
    modified: boolean, current: boolean, is_stage: boolean,
  }[] }[],
}
```

Report the window and tab layout so the agent can see
what is on screen: every window across every tab, the
focused window and pi's stage window. Read-only.

### `nvim.window.focus`

```
nvim.window.focus(win: number) → { ok: boolean, win?: number, error?: string }
```

Move the human's focus to a window. This is the one verb
that deliberately moves focus, used when the agent is
asked to draw attention to something it prepared.
Refuses with `ok: false` when the window handle is no
longer valid.

### `nvim.window.close`

```
nvim.window.close(win: number) → { ok: boolean, error?: string }
```

Close a window pi owns. Refuses any window pi did not
create, so the human's windows are never closed out from
under them, and reports rather than throws when nvim
declines to close the last window on screen.

### `nvim.buffer.list`

```
nvim.buffer.list() → {
  bufnr: number, name: string, listed: boolean,
  loaded: boolean, modified: boolean, owned: boolean,
}[]
```

List every buffer, including buffers loaded but not
shown in any window. `owned` marks the buffers pi
opened. Read-only.

### `nvim.buffer.info`

```
nvim.buffer.info(bufnr: number) →
  { ok: true, bufnr, name, listed, loaded, modified, owned, lines, changedtick }
  | { ok: false, error }
```

The single-buffer companion to `nvim.buffer.list`: the
same flags plus the line count and changedtick, so the
agent can frame ranges and arm the edit path's conflict
check in one round trip. The line count is meaningful
only once the buffer is loaded. Read-only.

### `nvim.buffer.switch`

```
nvim.buffer.switch(bufnr: number) → { ok: boolean, win?: number, bufnr?: number, error?: string }
```

Show an existing buffer on pi's stage window. The swap
lands in a window pi owns, so it never moves the human's
focus, and it is non-destructive: any valid buffer is
fair game, not just buffers pi owns. Editing the buffer
afterwards still gates on the ownership ledger.

### `nvim.buffer.delete`

```
nvim.buffer.delete(bufnr: number, force?: boolean) → { ok: boolean, modified?: boolean, error?: string }
```

Remove a buffer pi opened (via `nvim_buf_delete`). Named
`delete` to stay distinct from `nvim.window.close`, which
only closes a window. Refuses a buffer pi does not own,
so the human's buffers are never removed. A buffer with
unsaved changes is the E89 condition: rather than let
that error surface raw, `delete` reports `modified: true`
as a confirm trigger, and `force` discards the changes
and goes through.

### `nvim.diff.files`

```
nvim.diff.files(left: string, right: string) → {
  left: { win, bufnr }, right: { win, bufnr }
}
```

Show two real files side by side in diff mode. The left
file lands on pi's primary stage and the right splits
beside it, so the comparison appears in pi-owned windows
without moving the human's focus. `diffthis` runs inside
each window so it acts on the right one. The buffers are
plain file buffers, not claimed in the ownership ledger,
since this is a comparison rather than an edit session.

### `nvim.diff.pending`

```
nvim.diff.pending(bufnr: number) → {
  ok: boolean, original?: { win, bufnr }, pending?: { win, bufnr }, error?: string
}
```

Show an owned buffer's unsaved edits as a live diff against
the file on disk — the read side of the editing flow. It
follows the classic `:DiffOrig` pattern: a throwaway scratch
buffer (`bufhidden = wipe`) holds the on-disk bytes on the
left while the real buffer holds the pending edits on the
right, and neovim recomputes the diff as pi keeps editing.
This is an optional review lens, not a gate: editing the
owned buffer already reflects in the editor live, and this
just frames the pending change. "Accept" is `nvim.file.save`
(persist) and "reject" is `nvim.file.reload` with `force`
(discard); neither blocks. Refuses a buffer pi does not own
or one with no file on disk, so it stays the third member of
the save/reload trio. Tear down with `off` on each window
plus `nvim.window.close`.

### `nvim.diff.off`

```
nvim.diff.off(win: number) → { ok: boolean, error?: string }
```

Turn off diff mode in a window pi owns. Refuses any window
pi did not create, mirroring `nvim.window.close`. Pairs
with `close` for full teardown: `off` ends the diff, close
removes the window.

### `nvim.status.publish`

```
nvim.status.publish(composed: string) → void
```

Receive a composed pi status fragment. The plugin
doesn't render it; user config can pull from
`require("neovim-pi").status()` to display in
statusline or winbar.
