// Compile a validated Educational DSL lesson into a Quickdraw transaction tape.
// Maintains a live record map so every `updated` entry is a proper [from, to] pair.

import { validateLesson } from './schema.js'
import { resolvePoint, anchorOnBounds, lineVector } from './layout.js'

const EMPTY_SNAPSHOT = { document: { store: {} } }

const emptyDiff = () => ({ added: {}, removed: {}, updated: {} })

const clone = (v) => structuredClone(v)

const shapeId = (id) => (id.startsWith('shape:') ? id : `shape:${id}`)

function geoRecord(id, { x, y, z, geo, w, h, color, size, dash, fill, font }) {
  return {
    id: shapeId(id),
    typeName: 'shape',
    type: 'geo',
    x, y, rot: 0, z,
    props: { geo, w, h, color, size, dash, fill, font },
  }
}

function lineRecord(id, { x, y, z, dx, dy, bend, color, size, dash, type = 'line' }) {
  return {
    id: shapeId(id),
    typeName: 'shape',
    type,
    x, y, rot: 0, z,
    props: {
      dx, dy, bend: bend || 0,
      color, size,
      dash: dash === 'draw' ? 'solid' : dash,
    },
  }
}

function textRecord(id, { x, y, z, content, color, size, font, type = 'text' }) {
  if (type === 'note') {
    return {
      id: shapeId(id),
      typeName: 'shape',
      type: 'note',
      x, y, rot: 0, z,
      props: { text: content, color, size, font, scale: 1 },
    }
  }
  return {
    id: shapeId(id),
    typeName: 'shape',
    type: 'text',
    x, y, rot: 0, z,
    props: { text: content, color, size, font, autosize: true, scale: 1 },
  }
}

function boundsOf(rec) {
  if (!rec) return { x: 0, y: 0, w: 0, h: 0 }
  const p = rec.props || {}
  if (rec.type === 'geo') return { x: rec.x, y: rec.y, w: p.w || 0, h: p.h || 0 }
  if (rec.type === 'line' || rec.type === 'arrow') {
    const dx = p.dx || 0, dy = p.dy || 0
    return {
      x: Math.min(rec.x, rec.x + dx),
      y: Math.min(rec.y, rec.y + dy),
      w: Math.abs(dx) || 1,
      h: Math.abs(dy) || 1,
    }
  }
  if (rec.type === 'note') return { x: rec.x, y: rec.y, w: 200, h: 200 }
  // text — rough box
  const len = (p.text || '').length
  return { x: rec.x, y: rec.y, w: Math.max(40, len * 10), h: 28 }
}

/**
 * @param {unknown} rawLesson
 * @returns {{ baseline: object, events: Array<{ t: number, diff: object }>, scene: string }}
 */
export function compileLesson(rawLesson) {
  const lesson = validateLesson(rawLesson)
  const { canvas, actions } = lesson

  /** @type {Map<string, object>} logical id → current record */
  const records = new Map()
  /** @type {Map<string, { x: number, y: number, w: number, h: number }>} */
  const bounds = new Map()

  let zCounter = 0
  const events = []

  const pushAdded = (t, rec) => {
    const diff = emptyDiff()
    diff.added[rec.id] = clone(rec)
    events.push({ t, diff })
  }

  const pushUpdated = (t, from, to) => {
    const diff = emptyDiff()
    diff.updated[to.id] = [clone(from), clone(to)]
    events.push({ t, diff })
  }

  const setRecord = (logicalId, rec) => {
    records.set(logicalId, rec)
    bounds.set(logicalId, boundsOf(rec))
  }

  for (const action of actions) {
    if (action.action === 'wait') continue

    if (action.action === 'create') {
      zCounter += 1
      const z = zCounter

      if (action.type === 'geo') {
        const finalW = action.w
        const finalH = action.h
        const point = resolvePoint(action.position, canvas, bounds, { w: finalW, h: finalH })

        if (action.growFrom && action.duration === 0) {
          // two-step: tiny seed then jump to size (matches tree.json style)
          const seed = geoRecord(action.id, {
            x: point.x + finalW / 2, y: point.y + finalH / 2, z,
            geo: action.geo, w: 1, h: 1,
            color: action.color, size: action.size, dash: action.dash, fill: action.fill, font: action.font,
          })
          pushAdded(action.at, seed)
          setRecord(action.id, seed)

          const grown = geoRecord(action.id, {
            x: point.x, y: point.y, z,
            geo: action.geo, w: finalW, h: finalH,
            color: action.color, size: action.size, dash: action.dash, fill: action.fill, font: action.font,
          })
          // if create already has full size intent via separate resize, growFrom alone
          // still emits final size at same tick+0 — callers should use resize for animation
          if (finalW > 1 || finalH > 1) {
            // only auto-grow when w/h were explicitly large on create without a later resize
            // Actually tree pattern: create at 1x1 then resize. So for create with w/h,
            // emit seed at `at` and full size at `at` if growFrom — better: seed then
            // same-timestamp update is odd. Prefer: seed at `at`, full at `at` only when
            // duration>0; when duration=0 and growFrom, emit seed then immediate update
            // at at+1 so replay shows growth.
            pushUpdated(action.at + 1, seed, grown)
            setRecord(action.id, grown)
          }
        } else if (action.duration > 0) {
          const seed = geoRecord(action.id, {
            x: point.x + finalW / 2, y: point.y + finalH / 2, z,
            geo: action.geo, w: 1, h: 1,
            color: action.color, size: action.size, dash: action.dash, fill: action.fill, font: action.font,
          })
          pushAdded(action.at, seed)
          setRecord(action.id, seed)
          const grown = geoRecord(action.id, {
            x: point.x, y: point.y, z,
            geo: action.geo, w: finalW, h: finalH,
            color: action.color, size: action.size, dash: action.dash, fill: action.fill, font: action.font,
          })
          pushUpdated(action.at + action.duration, seed, grown)
          setRecord(action.id, grown)
        } else {
          const rec = geoRecord(action.id, {
            x: point.x, y: point.y, z,
            geo: action.geo, w: finalW, h: finalH,
            color: action.color, size: action.size, dash: action.dash, fill: action.fill, font: action.font,
          })
          pushAdded(action.at, rec)
          setRecord(action.id, rec)
        }
      } else if (action.type === 'line' || action.type === 'arrow') {
        let origin
        if (action.fromId && bounds.has(action.fromId)) {
          origin = anchorOnBounds(bounds.get(action.fromId), action.direction)
        } else {
          origin = resolvePoint(action.position, canvas, bounds, { w: 0, h: 0 })
        }
        const vec = lineVector(action.direction, action.length)
        const seedVec = { dx: Math.sign(vec.dx || 1) * 0.01, dy: Math.sign(vec.dy || 1) * 0.01 }

        const seed = lineRecord(action.id, {
          x: origin.x, y: origin.y, z,
          ...seedVec, bend: 0,
          color: action.color, size: action.size, dash: action.dash, type: action.type,
        })
        pushAdded(action.at, seed)
        setRecord(action.id, seed)

        if (action.growFrom) {
          const full = lineRecord(action.id, {
            x: origin.x, y: origin.y, z,
            dx: vec.dx, dy: vec.dy, bend: action.bend,
            color: action.color, size: action.size, dash: action.dash, type: action.type,
          })
          const tEnd = action.at + Math.max(1, action.duration)
          pushUpdated(tEnd, seed, full)
          setRecord(action.id, full)
        }
      } else if (action.type === 'text' || action.type === 'note') {
        const approxW = action.type === 'note' ? 200 : Math.max(40, (action.content || '').length * 10)
        const approxH = action.type === 'note' ? 200 : 28
        const point = resolvePoint(action.position, canvas, bounds, { w: approxW, h: approxH })
        const rec = textRecord(action.id, {
          x: point.x, y: point.y, z,
          content: action.content,
          color: action.color, size: action.size, font: action.font, type: action.type,
        })
        pushAdded(action.at, rec)
        setRecord(action.id, rec)
      }
      continue
    }

    if (action.action === 'resize') {
      const cur = records.get(action.id)
      if (!cur || cur.type !== 'geo') {
        throw new Error(`resize: unknown geo id "${action.id}"`)
      }
      const from = clone(cur)
      const p = from.props
      const w = action.w ?? p.w
      const h = action.h ?? p.h
      // keep center stable when growing
      const cx = from.x + p.w / 2
      const cy = from.y + p.h / 2
      const to = geoRecord(action.id, {
        x: cx - w / 2,
        y: cy - h / 2,
        z: from.z,
        geo: p.geo,
        w, h,
        color: p.color, size: p.size, dash: p.dash, fill: p.fill, font: p.font,
      })
      const t = action.at + Math.max(0, action.duration)
      // if duration>0 and from is already full, still one update at end
      pushUpdated(t || action.at, from, to)
      setRecord(action.id, to)
      continue
    }

    if (action.action === 'extend') {
      const cur = records.get(action.id)
      if (!cur || (cur.type !== 'line' && cur.type !== 'arrow')) {
        throw new Error(`extend: unknown line/arrow id "${action.id}"`)
      }
      const from = clone(cur)
      let dx = action.dx
      let dy = action.dy
      if (action.length != null && action.direction) {
        const v = lineVector(action.direction, action.length)
        dx = v.dx
        dy = v.dy
      }
      dx = dx ?? from.props.dx
      dy = dy ?? from.props.dy
      const bend = action.bend ?? from.props.bend
      const to = lineRecord(action.id, {
        x: from.x, y: from.y, z: from.z,
        dx, dy, bend,
        color: from.props.color, size: from.props.size, dash: from.props.dash, type: from.type,
      })
      pushUpdated(action.at + Math.max(0, action.duration), from, to)
      setRecord(action.id, to)
      continue
    }

    if (action.action === 'move') {
      const cur = records.get(action.id)
      if (!cur) throw new Error(`move: unknown id "${action.id}"`)
      const from = clone(cur)
      const b = boundsOf(from)
      const point = resolvePoint(action.position, canvas, bounds, { w: b.w, h: b.h })
      const to = { ...from, x: point.x, y: point.y }
      pushUpdated(action.at + Math.max(0, action.duration), from, to)
      setRecord(action.id, to)
      continue
    }

    if (action.action === 'label') {
      zCounter += 1
      const approxW = Math.max(40, action.content.length * 10)
      const point = resolvePoint(action.position, canvas, bounds, { w: approxW, h: 28 })
      const rec = textRecord(action.id, {
        x: point.x, y: point.y, z: zCounter,
        content: action.content,
        color: action.color, size: action.size, font: action.font, type: 'text',
      })
      pushAdded(action.at, rec)
      setRecord(action.id, rec)
    }
  }

  // stable sort by t (compiler may emit at+1 grow steps)
  events.sort((a, b) => a.t - b.t)

  return {
    baseline: clone(EMPTY_SNAPSHOT),
    events,
    scene: lesson.scene,
  }
}
