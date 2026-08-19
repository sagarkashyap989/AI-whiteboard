# Record & replay — how it works

This demo feature lives in [`App.jsx`](./src/App.jsx). It does **not** capture video or canvas frames. Instead it records Quickdraw’s **document diffs** (the same format used for sync and undo) and plays them back on a timer.

## Mental model

Every edit on the board (a stroke point, a shape resize, a delete, etc.) goes through the `Store` as a transaction. After each transaction the store emits a JSON-safe **diff**:

```js
{
  added: { [id]: record },
  removed: { [id]: record },
  updated: { [id]: [from, to] },
}
```

Recording = “save the board as it was, then log every user diff with a timestamp.”  
Playback = “restore that board, then re-apply the diffs in order with the same delays.”

```
Record pressed
    │
    ├─ baseline = store.getSnapshot()     // full document at t=0
    ├─ t0 = Date.now()
    └─ store.listen(user diffs) ─────────► events[] = [{ t, diff }, ...]

Stop pressed
    │
    └─ unsubscribe; keep baseline + events (also in sessionStorage)

Play pressed
    │
    ├─ store.loadSnapshot(baseline)       // reset to start state
    └─ for each event: setTimeout(t) → store.applyDiff(diff, 'remote')
```

## UI controls

Top-right of the React demo:

| Control | Action |
| --- | --- |
| **Record** / **Stop** | Toggle recording. While recording, the button turns red-tinted and says Stop. |
| **Play** / **Stop play** | Replay the last finished recording, or cancel an in-progress replay. |
| Status text | `Idle` · `Recording…` · `Playing…` |

Left **Transactions** sidebar:

| Piece | Behavior |
| --- | --- |
| Event list | Grows live while recording (`#n`, `t` ms, `+added ~updated -removed` summary) |
| Selection | Click a row to inspect its diff |
| Import | Paste full tape `{ baseline, events }` or bare `[{ t, diff }, …]` → **Load** / **Load & Play** |
| Upload JSON | Same formats from a `.json` file |
| Export | Copy current tape to clipboard (and show it in the import box) |
| Edit panel | After **Stop**: change `t` and/or the diff JSON → **Apply & Play** (saves and immediately replays) |
| Delete | Remove the selected transaction from the tape |
| Play | Runs the **current** (possibly edited) list, sorted by `t` |

Rules:

- **Play** is disabled until you have stopped a recording that captured at least one change.
- **Record** is disabled while playing.
- Starting a new recording replaces the previous one.
- Edits are read-only while recording or playing.
- During play, `<Quickdraw readonly />` is on so you can’t draw over the replay.

## What each helper does

### `startRecording`

1. Clears any playback timers.
2. Clones the current document with `store.getSnapshot()` into `baselineRef`.
3. Resets `eventsRef` to `[]` and notes `t0 = Date.now()`.
4. Subscribes with:

   ```js
   store.listen((diff) => {
     eventsRef.current.push({ t: Date.now() - t0, diff })
   }, { source: 'user' })
   ```

   `{ source: 'user' }` ignores remote/replay diffs so we only capture real local edits.

### `stopRecording`

1. Unsubscribes the listener.
2. If there is a baseline and at least one event, saves `{ baseline, events }` to `sessionStorage` under `quickdraw-react-demo-recording`.
3. Sets `hasRecording` so Play unlocks.

### `playRecording`

1. Loads the baseline via `store.loadSnapshot(baseline, 'remote')` — the board jumps back to how it looked when Record was pressed.
2. For every `{ t, diff }`, schedules:

   ```js
   setTimeout(() => store.applyDiff(diff, 'remote'), t)
   ```

3. After the last event (+50ms), returns mode to `idle`.

`applyDiff(..., 'remote')` is intentional: remote diffs do **not** push onto the undo stack, so replay doesn’t fill history the way live drawing would.

### `stopPlayback`

Clears all pending timers and returns to `idle`. The board stays wherever the replay had reached (it does not auto-restore).

## Data kept in memory / storage

| Piece | Where | Purpose |
| --- | --- | --- |
| `baselineRef` | React ref | Snapshot at record start |
| `eventsRef` | React ref | Timed diffs `{ t, diff }[]` |
| `sessionStorage` | Browser tab | Same payload so a refresh in the same tab can still Play |
| Board document | `localStorage` (`quickdraw-react-demo`) | Normal demo persistence — unrelated to the recording tape |

Closing the tab clears `sessionStorage`; the recording is gone. The board itself may still reload from `localStorage`.

## What is and isn’t recorded

**Recorded** (anything that mutates the store as a user edit):

- Freehand / highlight strokes  
- Geo shapes, arrows, lines, text, notes, images  
- Moves, resizes, deletes, style changes that write to the store  
- Undo/redo during recording (they emit user diffs too)

**Not recorded:**

- Camera pan / zoom (editor camera, not store records)  
- Laser pointer scribbles (ephemeral overlay)  
- Theme / grid UI toggles outside the document  

## Why this works with Quickdraw

The engine was designed so the diff *is* the wire format. The docs describe the same idea for sync and audit:

```js
store.listen((diff) => socket.send(JSON.stringify(diff)), { source: 'user' })
socket.onmessage = (e) => store.applyDiff(JSON.parse(e.data), 'remote')
```

Record/replay is that pattern with timestamps instead of a network — an op-log you play locally.

## Where to read the code

| Concern | Location |
| --- | --- |
| Demo UI + record/play logic | [`examples/react-demo/src/App.jsx`](./src/App.jsx) |
| Diff emit / `applyDiff` / snapshots | [`packages/core/src/store.js`](../../packages/core/src/store.js) |
| Canvas redraw after store changes | [`packages/core/src/editor.js`](../../packages/core/src/editor.js) (`store.listen` → `requestRender`) |

## Try it

```bash
npm run dev
```

1. Click **Record**  
2. Draw something  
3. Click **Stop**  
4. Click **Play** — the board resets to the baseline and redraws with the original timing  
