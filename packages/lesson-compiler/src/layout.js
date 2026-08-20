// Semantic layout → absolute anchors and deltas for the transaction compiler.

import { DISTANCE_IDS } from './schema.js'

const DISTANCE_PX = { near: 40, medium: 90, far: 160 }

const SLOT_FRAC = {
  'top-left': [0.18, 0.18],
  top: [0.5, 0.16],
  'top-right': [0.82, 0.18],
  'center-left': [0.18, 0.5],
  center: [0.5, 0.5],
  'center-right': [0.82, 0.5],
  'bottom-left': [0.18, 0.82],
  bottom: [0.5, 0.84],
  'bottom-right': [0.82, 0.82],
}

/** Unit vector for a named direction (screen y grows downward). */
export function directionDelta(direction) {
  switch (direction) {
    case 'top': return { dx: 0, dy: -1 }
    case 'bottom': return { dx: 0, dy: 1 }
    case 'left': return { dx: -1, dy: 0 }
    case 'right': return { dx: 1, dy: 0 }
    case 'top-left': return { dx: -0.7, dy: -0.7 }
    case 'top-right': return { dx: 0.7, dy: -0.7 }
    case 'bottom-left': return { dx: -0.7, dy: 0.7 }
    case 'bottom-right': return { dx: 0.7, dy: 0.7 }
    default: return { dx: 1, dy: 0 }
  }
}

export function distancePx(distance = 'medium') {
  return DISTANCE_PX[DISTANCE_IDS.includes(distance) ? distance : 'medium']
}

/**
 * Resolve a position descriptor to a point.
 * @param {object} position normalized from schema
 * @param {{ width: number, height: number }} canvas
 * @param {Map<string, { x: number, y: number, w: number, h: number }>} boundsById
 * @param {{ w?: number, h?: number }} selfSize size of the object being placed (for centering)
 */
export function resolvePoint(position, canvas, boundsById, selfSize = {}) {
  const sw = selfSize.w ?? 0
  const sh = selfSize.h ?? 0

  if (!position || position.kind === 'slot') {
    const slot = position?.slot || 'center'
    const [fx, fy] = SLOT_FRAC[slot] || SLOT_FRAC.center
    return {
      x: canvas.width * fx - sw / 2,
      y: canvas.height * fy - sh / 2,
    }
  }

  if (position.kind === 'absolute') {
    return { x: position.x - sw / 2, y: position.y - sh / 2 }
  }

  if (position.kind === 'relative') {
    const ref = boundsById.get(position.relativeTo)
    if (!ref) {
      // fall back to center if the target isn't placed yet
      const [fx, fy] = SLOT_FRAC.center
      return { x: canvas.width * fx - sw / 2, y: canvas.height * fy - sh / 2 }
    }
    const { dx, dy } = directionDelta(position.direction)
    const dist = distancePx(position.distance)
    const cx = ref.x + ref.w / 2
    const cy = ref.y + ref.h / 2
    // place outside the ref box along the direction
    const gapX = (ref.w / 2 + sw / 2 + dist) * Math.abs(dx)
    const gapY = (ref.h / 2 + sh / 2 + dist) * Math.abs(dy)
    return {
      x: cx + Math.sign(dx || 0) * gapX - sw / 2,
      y: cy + Math.sign(dy || 0) * gapY - sh / 2,
    }
  }

  return { x: canvas.width / 2 - sw / 2, y: canvas.height / 2 - sh / 2 }
}

/** Anchor point on (or near) an existing object's bounds for line starts. */
export function anchorOnBounds(bounds, direction = 'top') {
  const { dx, dy } = directionDelta(direction)
  const cx = bounds.x + bounds.w / 2
  const cy = bounds.y + bounds.h / 2
  return {
    x: cx + (bounds.w / 2) * dx,
    y: cy + (bounds.h / 2) * dy,
  }
}

export function lineVector(direction, length) {
  const { dx, dy } = directionDelta(direction)
  const len = Math.hypot(dx, dy) || 1
  return {
    dx: (dx / len) * length,
    dy: (dy / len) * length,
  }
}
