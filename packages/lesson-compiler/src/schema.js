// Educational DSL constants and validation.
// The DSL is intentionally small: create / resize / extend / move / label / wait.
// Coordinates are semantic; the layout engine resolves them before compile.

export const COLOR_IDS = [
  'black', 'grey', 'light-violet', 'violet', 'blue', 'light-blue',
  'yellow', 'orange', 'green', 'light-green', 'light-red', 'red',
]

export const GEO_IDS = ['rectangle', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star', 'cloud']
export const SIZE_IDS = ['s', 'm', 'l', 'xl']
export const DASH_IDS = ['draw', 'solid', 'dashed', 'dotted']
export const FILL_IDS = ['none', 'semi', 'solid', 'pattern']
export const FONT_IDS = ['draw', 'sans', 'serif', 'mono']

export const SLOT_IDS = [
  'top', 'top-left', 'top-right',
  'center', 'center-left', 'center-right',
  'bottom', 'bottom-left', 'bottom-right',
]

export const DIRECTION_IDS = [
  'top', 'top-left', 'top-right',
  'left', 'right',
  'bottom', 'bottom-left', 'bottom-right',
]

export const DISTANCE_IDS = ['near', 'medium', 'far']

export const ACTION_IDS = ['create', 'resize', 'extend', 'move', 'label', 'wait']

export const CREATE_TYPES = ['geo', 'line', 'arrow', 'text', 'note']

export class DslError extends Error {
  constructor(message, path = '') {
    super(path ? `${path}: ${message}` : message)
    this.name = 'DslError'
  }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)

const requireString = (v, path, { allowEmpty = false } = {}) => {
  if (typeof v !== 'string' || (!allowEmpty && !v.trim())) {
    throw new DslError('expected a non-empty string', path)
  }
  return v
}

const requireNumber = (v, path, { min = -Infinity } = {}) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n < min) {
    throw new DslError(`expected a number >= ${min}`, path)
  }
  return n
}

const optionalEnum = (v, list, path) => {
  if (v == null) return undefined
  if (!list.includes(v)) throw new DslError(`expected one of ${list.join(', ')}`, path)
  return v
}

const parsePosition = (pos, path) => {
  if (pos == null) return undefined
  if (typeof pos === 'string') {
    if (!SLOT_IDS.includes(pos)) throw new DslError(`unknown slot "${pos}"`, path)
    return { kind: 'slot', slot: pos }
  }
  if (!isObj(pos)) throw new DslError('position must be a slot string or object', path)
  if (pos.relativeTo) {
    const relativeTo = requireString(pos.relativeTo, `${path}.relativeTo`)
    const direction = optionalEnum(pos.direction || 'top', DIRECTION_IDS, `${path}.direction`)
    const distance = optionalEnum(pos.distance || 'medium', DISTANCE_IDS, `${path}.distance`)
    return { kind: 'relative', relativeTo, direction, distance }
  }
  if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    return { kind: 'absolute', x: Number(pos.x), y: Number(pos.y) }
  }
  throw new DslError('position needs slot, {x,y}, or {relativeTo, direction, distance}', path)
}

/**
 * Validate and normalize a lesson DSL document.
 * @returns {{ scene: string, canvas: { width: number, height: number }, actions: object[] }}
 */
export function validateLesson(raw) {
  if (!isObj(raw)) throw new DslError('lesson must be a JSON object')
  if (!Array.isArray(raw.actions)) throw new DslError('lesson.actions must be an array')

  const scene = typeof raw.scene === 'string' ? raw.scene : 'lesson'
  const canvas = {
    width: requireNumber(raw.canvas?.width ?? 1000, 'canvas.width', { min: 100 }),
    height: requireNumber(raw.canvas?.height ?? 700, 'canvas.height', { min: 100 }),
  }

  const seen = new Set()
  const actions = raw.actions.map((action, i) => {
    const path = `actions[${i}]`
    if (!isObj(action)) throw new DslError('action must be an object', path)
    const kind = optionalEnum(action.action, ACTION_IDS, `${path}.action`)
    if (!kind) throw new DslError('missing action', path)

    // at: ms by default; if unit === 's', convert
    let at = requireNumber(action.at ?? 0, `${path}.at`, { min: 0 })
    if (action.unit === 's') at = Math.round(at * 1000)
    const duration = action.duration == null
      ? 0
      : requireNumber(action.duration, `${path}.duration`, { min: 0 })

    if (kind === 'wait') {
      return { action: 'wait', at, duration }
    }

    const id = requireString(action.id, `${path}.id`)

    if (kind === 'create') {
      if (seen.has(id)) throw new DslError(`duplicate id "${id}"`, path)
      seen.add(id)
      const type = optionalEnum(action.type, CREATE_TYPES, `${path}.type`)
      if (!type) throw new DslError('create requires type', path)
      const color = optionalEnum(action.color || 'black', COLOR_IDS, `${path}.color`)
      const size = optionalEnum(action.size || 'm', SIZE_IDS, `${path}.size`)
      const dash = optionalEnum(action.dash || 'solid', DASH_IDS, `${path}.dash`)
      const fill = optionalEnum(action.fill || 'solid', FILL_IDS, `${path}.fill`)
      const font = optionalEnum(action.font || 'draw', FONT_IDS, `${path}.font`)
      const position = parsePosition(action.position ?? 'center', `${path}.position`)
      const base = { action: 'create', id, type, at, duration, color, size, dash, fill, font, position }

      if (type === 'geo') {
        const geo = optionalEnum(action.geo || 'rectangle', GEO_IDS, `${path}.geo`)
        const w = requireNumber(action.w ?? 80, `${path}.w`, { min: 1 })
        const h = requireNumber(action.h ?? 80, `${path}.h`, { min: 1 })
        const growFrom = action.growFrom === false ? false : true
        return { ...base, geo, w, h, growFrom }
      }
      if (type === 'line' || type === 'arrow') {
        const length = requireNumber(action.length ?? 100, `${path}.length`, { min: 1 })
        const direction = optionalEnum(action.direction || 'right', DIRECTION_IDS, `${path}.direction`)
        const bend = Number(action.bend) || 0
        const fromId = action.from ? requireString(action.from, `${path}.from`) : null
        return { ...base, length, direction, bend, fromId, growFrom: action.growFrom !== false }
      }
      if (type === 'text' || type === 'note') {
        const content = requireString(action.content ?? action.text ?? '', `${path}.content`, { allowEmpty: true })
        return { ...base, content }
      }
      return base
    }

    if (kind === 'resize') {
      const w = action.w == null ? undefined : requireNumber(action.w, `${path}.w`, { min: 1 })
      const h = action.h == null ? undefined : requireNumber(action.h, `${path}.h`, { min: 1 })
      if (w == null && h == null) throw new DslError('resize needs w and/or h', path)
      return { action: 'resize', id, at, duration, w, h }
    }

    if (kind === 'extend') {
      const dx = action.dx == null ? undefined : requireNumber(action.dx, `${path}.dx`)
      const dy = action.dy == null ? undefined : requireNumber(action.dy, `${path}.dy`)
      const length = action.length == null ? undefined : requireNumber(action.length, `${path}.length`, { min: 1 })
      const direction = action.direction
        ? optionalEnum(action.direction, DIRECTION_IDS, `${path}.direction`)
        : undefined
      const bend = action.bend == null ? undefined : Number(action.bend)
      return { action: 'extend', id, at, duration, dx, dy, length, direction, bend }
    }

    if (kind === 'move') {
      const position = parsePosition(action.position, `${path}.position`)
      if (!position) throw new DslError('move requires position', path)
      return { action: 'move', id, at, duration, position }
    }

    if (kind === 'label') {
      const content = requireString(action.content ?? action.text, `${path}.content`)
      const color = optionalEnum(action.color || 'black', COLOR_IDS, `${path}.color`)
      const size = optionalEnum(action.size || 'm', SIZE_IDS, `${path}.size`)
      const font = optionalEnum(action.font || 'draw', FONT_IDS, `${path}.font`)
      const labelId = action.labelId || `${id}_label`
      const position = parsePosition(
        action.position || { relativeTo: id, direction: 'bottom', distance: 'near' },
        `${path}.position`,
      )
      if (seen.has(labelId)) throw new DslError(`duplicate id "${labelId}"`, path)
      seen.add(labelId)
      return {
        action: 'label',
        id: labelId,
        targetId: id,
        at,
        duration,
        content,
        color,
        size,
        font,
        position,
      }
    }

    throw new DslError(`unhandled action "${kind}"`, path)
  })

  // sort by time for stable compile; keep original order for equal timestamps
  actions.forEach((a, i) => { a._i = i })
  actions.sort((a, b) => a.at - b.at || a._i - b._i)

  return { scene, canvas, actions }
}

/** True if a parsed/raw object looks like a lesson DSL (not a tape). */
export function isLessonDsl(data) {
  return !!(data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.actions))
}
