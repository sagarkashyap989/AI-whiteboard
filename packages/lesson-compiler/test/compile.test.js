import { describe, expect, it } from 'vitest'
import { compileLesson, validateLesson, isLessonDsl, DslError } from '../src/index.js'

describe('validateLesson', () => {
  it('rejects bad colors', () => {
    expect(() => validateLesson({
      actions: [{ action: 'create', id: 'a', type: 'geo', color: 'brown', w: 10, h: 10 }],
    })).toThrow(DslError)
  })

  it('accepts a minimal create', () => {
    const lesson = validateLesson({
      scene: 'demo',
      actions: [{ at: 0, action: 'create', id: 'box', type: 'geo', geo: 'rectangle', w: 40, h: 40, color: 'blue' }],
    })
    expect(lesson.actions[0].id).toBe('box')
    expect(lesson.canvas.width).toBe(1000)
  })

  it('detects lesson dsl vs tape', () => {
    expect(isLessonDsl({ actions: [] })).toBe(true)
    expect(isLessonDsl({ events: [] })).toBe(false)
  })
})

describe('compileLesson', () => {
  it('emits proper [from, to] updates on resize', () => {
    const tape = compileLesson({
      actions: [
        { at: 0, action: 'create', id: 'trunk', type: 'geo', geo: 'rectangle', w: 1, h: 1, color: 'orange', growFrom: false, position: 'center' },
        { at: 200, action: 'resize', id: 'trunk', w: 40, h: 160 },
      ],
    })
    expect(tape.events.length).toBe(2)
    expect(tape.events[0].diff.added['shape:trunk']).toBeTruthy()
    const pair = tape.events[1].diff.updated['shape:trunk']
    expect(pair).toHaveLength(2)
    expect(pair[0].props.w).toBe(1)
    expect(pair[1].props.w).toBe(40)
    expect(pair[1].props.h).toBe(160)
  })

  it('compiles a line from an object with extend', () => {
    const tape = compileLesson({
      actions: [
        { at: 0, action: 'create', id: 'trunk', type: 'geo', geo: 'rectangle', w: 40, h: 160, color: 'orange', growFrom: false, position: 'center' },
        { at: 100, action: 'create', id: 'branch', type: 'line', from: 'trunk', direction: 'top-left', length: 100, color: 'orange' },
      ],
    })
    const lineAdd = tape.events.find((e) => e.diff.added['shape:branch'])
    const lineUp = tape.events.find((e) => e.diff.updated['shape:branch'])
    expect(lineAdd).toBeTruthy()
    expect(lineUp.diff.updated['shape:branch']).toHaveLength(2)
    expect(lineUp.diff.updated['shape:branch'][1].props.dx).not.toBe(0)
  })
})
