# @quickdrawjs/lesson-compiler

Educational **DSL → Quickdraw transaction tape** compiler.

```text
lesson JSON (actions)  →  validate  →  layout  →  compile  →  { baseline, events }
```

The whiteboard never sees the DSL — only timed diffs it already knows how to play.

## Usage

```js
import { compileLesson, validateLesson, isLessonDsl } from '@quickdrawjs/lesson-compiler'

const tape = compileLesson({
  scene: 'tree',
  canvas: { width: 1000, height: 700 },
  actions: [
    { at: 0, action: 'create', id: 'trunk', type: 'geo', geo: 'rectangle', w: 40, h: 160, color: 'orange', growFrom: false },
    { at: 200, action: 'resize', id: 'trunk', w: 40, h: 200 },
  ],
})
// tape.events → Load & Play in the react demo
```

See [`examples/react-demo/LESSON_DSL.md`](../../examples/react-demo/LESSON_DSL.md) for the full action vocabulary.
