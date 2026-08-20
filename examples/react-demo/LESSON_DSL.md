# Educational DSL (v1)

The React demo can import either:

1. **Transaction tape** (bytecode) — `{ baseline, events: [{ t, diff }] }`
2. **Lesson DSL** — `{ scene, canvas?, actions: [...] }`
3. **Natural language** — **Generate** button → Gemini (or Grok) writes DSL → compile → play

If the JSON has an `actions` array, [`@quickdrawjs/lesson-compiler`](../../packages/lesson-compiler) compiles it to a tape, then the existing replay engine plays it.

```text
Prompt ("draw a tree")
        ↓
  POST /api/generate-lesson  (Vite server + GEMINI_API_KEY)
        ↓
  Educational DSL JSON
        ↓
  validate + layout + compile
        ↓
  { baseline, events }
        ↓
  Load & Play
```

## Generate from prompt

1. Put your Gemini key in the **repo-root** `.env` (see [`.env.example`](../../.env.example)):

   ```bash
   GEMINI_API_KEY=...
   GEMINI_MODEL=gemini-3.6-flash
   ```

   Use a lowercase API model id from [Google AI Studio](https://aistudio.google.com/docs/get-started?codelanguage=javascript) (e.g. `gemini-3.6-flash`). Display names like `Gemini-3.7-flash` are rejected; `gemini-2.0-flash` is retired.

   If `GEMINI_API_KEY` is set, Gemini is used. Otherwise the server falls back to `GROKE_API_KEY` / Grok.

2. Restart `npm run dev` so Vite loads the env.

3. Click **Generate** (top-right) → type e.g. `draw a tree` → **Generate & Play**.

The browser only calls `/api/generate-lesson`. The Vite middleware calls Google’s Gemini API (or xAI) with your key. Returned DSL is compiled with `compileLesson` and auto-played; the Import panel shows the DSL for inspection.

## Why a DSL?

LLMs (and humans) are bad at emitting valid Quickdraw diffs (`updated` must be `[from, to]`, lines use `dx`/`dy`, colors are a fixed enum). The DSL is a small vocabulary; the **compiler** owns the bytecode.

## Fixture

[`scripts/transaction/tree.lesson.json`](../../scripts/transaction/tree.lesson.json) — progressive tree (trunk → branches → crown → label).

In the demo: **Import** → paste or **Upload JSON** → **Load & Play**.

## Actions

| `action` | Fields | Notes |
| --- | --- | --- |
| `create` | `id`, `type`, `at`, `position?`, style props | `type`: `geo` \| `line` \| `arrow` \| `text` \| `note` |
| `resize` | `id`, `w`/`h`, `at` | geo only; emits proper `[from, to]` |
| `extend` | `id`, `dx`/`dy` or `length`+`direction`, `at` | line/arrow |
| `move` | `id`, `position`, `at` | |
| `label` | `id` (target), `content`, `at` | creates a text shape near the target |
| `wait` | `at`, `duration?` | timing only (no draw) |

`at` is **milliseconds** from lesson start. Use `"unit": "s"` on an action to treat `at`/`duration` as seconds.

### `create` — geo

```json
{
  "at": 0,
  "action": "create",
  "id": "trunk",
  "type": "geo",
  "geo": "rectangle",
  "w": 40,
  "h": 160,
  "color": "orange",
  "position": "center",
  "growFrom": false
}
```

`growFrom: true` (default for large geos) seeds a 1×1 shape then updates to full size.

### `create` — line from another object

```json
{
  "at": 500,
  "action": "create",
  "id": "left_branch",
  "type": "line",
  "from": "trunk",
  "direction": "top-left",
  "length": 110,
  "color": "orange"
}
```

### Positions

- Slots: `top`, `top-left`, `top-right`, `center`, `center-left`, `center-right`, `bottom`, `bottom-left`, `bottom-right`
- Absolute: `{ "x": 500, "y": 380 }` (treated as center of the object)
- Relative: `{ "relativeTo": "trunk", "direction": "top", "distance": "near"|"medium"|"far" }`

## Colors

Only Quickdraw palette ids:

`black`, `grey`, `light-violet`, `violet`, `blue`, `light-blue`, `yellow`, `orange`, `green`, `light-green`, `light-red`, `red`

## Programmatic compile

```js
import { compileLesson } from '@quickdrawjs/lesson-compiler'

const tape = compileLesson(lessonJson)
// → { baseline, events, scene }
```
