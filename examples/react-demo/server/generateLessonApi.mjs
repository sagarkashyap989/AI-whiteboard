// System prompt + helpers for POST /api/generate-lesson (Vite middleware).
// Runs only on the Node/Vite server — never bundled into the browser.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dbgDir = path.dirname(fileURLToPath(import.meta.url))
const __dbgLog = path.resolve(__dbgDir, '../../../debug-f3b4a5.log')
// #region agent log
function agentLog(hypothesisId, location, message, data = {}) {
  const payload = { sessionId: 'f3b4a5', runId: 'pre-fix', hypothesisId, location, message, data, timestamp: Date.now() }
  try { fs.appendFileSync(__dbgLog, JSON.stringify(payload) + '\n') } catch { /* */ }
  fetch('http://127.0.0.1:7862/ingest/4e8a11cd-72ad-41be-89fd-70050574b66b', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f3b4a5' }, body: JSON.stringify(payload) }).catch(() => {})
}
// #endregion

export const SYSTEM_PROMPT = `You are a lesson author for an educational whiteboard.
Output ONLY valid JSON (no markdown fences, no commentary) matching this Educational DSL:

{
  "scene": "short-name",
  "canvas": { "width": 1000, "height": 700 },
  "actions": [ /* timed drawing actions */ ]
}

Allowed actions:
- create: { "at": ms, "action": "create", "id": "unique", "type": "geo"|"line"|"arrow"|"text"|"note", ... }
  - geo: "geo": "rectangle"|"ellipse"|"triangle"|"diamond"|"hexagon"|"star"|"cloud", "w", "h", "color", "position", "growFrom"?: boolean
  - line/arrow: "from"?: otherId, "direction", "length", "bend"?, "color"
  - text/note: "content", "color", "position"
- resize: { "at", "action": "resize", "id", "w"?, "h"? }
- extend: { "at", "action": "extend", "id", "dx"?, "dy"?, "length"?, "direction"?, "bend"? }
- move: { "at", "action": "move", "id", "position" }
- label: { "at", "action": "label", "id": targetId, "content", "color"?, "position"? }
- wait: { "at", "action": "wait", "duration"? }

Colors ONLY: black, grey, light-violet, violet, blue, light-blue, yellow, orange, green, light-green, light-red, red
  (no brown, purple, pink, white, etc.)

Positions:
- slots: "top"|"top-left"|"top-right"|"center"|"center-left"|"center-right"|"bottom"|"bottom-left"|"bottom-right"
- absolute: { "x": number, "y": number }
- relative: { "relativeTo": "id", "direction": "...", "distance": "near"|"medium"|"far" }

Directions: top, top-left, top-right, left, right, bottom, bottom-left, bottom-right

Timing: "at" is milliseconds from start. Prefer progressive reveal (create small → resize/extend), like drawing on a board.
Keep 6–20 actions. Use unique string ids. Prefer solid dash/fill for clarity.

Example (tree):
{
  "scene": "tree",
  "canvas": { "width": 1000, "height": 700 },
  "actions": [
    { "at": 0, "action": "create", "id": "trunk", "type": "geo", "geo": "rectangle", "position": "center", "color": "orange", "w": 1, "h": 1, "growFrom": false },
    { "at": 200, "action": "resize", "id": "trunk", "w": 40, "h": 160 },
    { "at": 500, "action": "create", "id": "left_branch", "type": "line", "from": "trunk", "direction": "top-left", "length": 110, "color": "orange" },
    { "at": 900, "action": "create", "id": "right_branch", "type": "line", "from": "trunk", "direction": "top-right", "length": 110, "color": "orange" },
    { "at": 1300, "action": "create", "id": "crown", "type": "geo", "geo": "ellipse", "position": { "relativeTo": "trunk", "direction": "top", "distance": "medium" }, "color": "green", "w": 1, "h": 1, "growFrom": false },
    { "at": 1500, "action": "resize", "id": "crown", "w": 180, "h": 140 },
    { "at": 1800, "action": "label", "id": "trunk", "content": "Tree", "color": "black" }
  ]
}`

/** Prefer Gemini; fall back to xAI Grok if only those keys exist. */
export function resolveLlmConfig(env) {
  if (env.GEMINI_API_KEY) {
    const cfg = {
      provider: 'gemini',
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL || 'gemini-3.6-flash',
    }
    // #region agent log
    agentLog('C', 'generateLessonApi.mjs:resolveLlmConfig', 'gemini config resolved', {
      modelRaw: env.GEMINI_MODEL ?? null,
      modelResolved: cfg.model,
      charCodes: [...String(cfg.model)].slice(0, 40).map((c) => c.charCodeAt(0)),
      startsWithModels: String(cfg.model).trim().startsWith('models/'),
    })
    // #endregion
    return cfg
  }
  const grokKey = env.GROKE_API_KEY || env.GROK_API_KEY || env.XAI_API_KEY || ''
  if (grokKey) {
    return {
      provider: 'grok',
      apiKey: grokKey,
      model: env.GROK_MODEL || env.XAI_MODEL || 'grok-3-latest',
    }
  }
  return null
}

export function extractJsonObject(text) {
  let s = String(text || '').trim()
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  }
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Model did not return a JSON object')
  return JSON.parse(s.slice(start, end + 1))
}

const USER_PROMPT = (prompt) =>
  `Create an Educational DSL lesson for this request:\n\n${prompt}\n\nRemember: JSON only, valid colors, progressive timed actions.`

/**
 * Google model ids are lowercase (e.g. gemini-3.6-flash).
 * Strips optional "models/" prefix; maps retired ids to the current default.
 */
export function normalizeGeminiModel(raw, fallback = 'gemini-3.6-flash') {
  let s = String(raw || '').trim()
  if (!s) return fallback
  if (s.startsWith('models/')) s = s.slice('models/'.length)
  s = s.toLowerCase()
  // API model ids: gemini-3.6-flash, gemini-2.5-flash-preview-..., etc.
  if (!/^gemini-[a-z0-9][a-z0-9._-]*$/.test(s)) return fallback
  // Retired: gemini-2.0-flash → current flash (API error message)
  if (s === 'gemini-2.0-flash' || s === 'gemini-2.0-flash-001') return fallback
  return s
}

export async function callGeminiForLesson(apiKey, prompt, { model = 'gemini-3.6-flash' } = {}) {
  const trimmed = String(model).trim()
  const normalized = normalizeGeminiModel(trimmed)
  const modelId = encodeURIComponent(normalized)
  const urlPath = `/v1beta/models/${modelId}:generateContent`
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`

  // #region agent log
  agentLog('A', 'generateLessonApi.mjs:callGeminiForLesson:before', 'about to call Gemini', {
    trimmed,
    normalized,
    modelId,
    urlPath,
    changed: trimmed !== normalized,
    runId: 'post-fix',
  })
  // #endregion

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: USER_PROMPT(prompt) }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    }),
  })

  const body = await res.json().catch(() => ({}))
  // #region agent log
  agentLog('A', 'generateLessonApi.mjs:callGeminiForLesson:after', 'Gemini HTTP response', {
    status: res.status,
    ok: res.ok,
    errorMessage: body?.error?.message || null,
    errorStatus: body?.error?.status || null,
    normalized,
    runId: 'post-fix',
  })
  // #endregion
  if (!res.ok) {
    const msg =
      body?.error?.message ||
      body?.error?.status ||
      res.statusText ||
      'Gemini request failed'
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }

  const parts = body?.candidates?.[0]?.content?.parts || []
  const content = parts.map((p) => p.text || '').join('')
  if (!content) {
    const block = body?.candidates?.[0]?.finishReason || body?.promptFeedback?.blockReason
    throw new Error(block ? `Empty Gemini response (${block})` : 'Empty response from Gemini')
  }
  return extractJsonObject(content)
}

export async function callGrokForLesson(apiKey, prompt, { model = 'grok-3-latest' } = {}) {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: USER_PROMPT(prompt) },
      ],
    }),
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = body?.error?.message || body?.error || res.statusText || 'xAI request failed'
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  const content = body?.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty response from Grok')
  return extractJsonObject(content)
}

export async function generateLessonFromLlm(env, prompt) {
  const cfg = resolveLlmConfig(env)
  if (!cfg) {
    throw new Error(
      'Missing GEMINI_API_KEY (preferred) or GROKE_API_KEY / GROK_API_KEY / XAI_API_KEY in repo-root .env',
    )
  }
  if (cfg.provider === 'gemini') {
    return callGeminiForLesson(cfg.apiKey, prompt, { model: cfg.model })
  }
  return callGrokForLesson(cfg.apiKey, prompt, { model: cfg.model })
}

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}'
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

export function sendJson(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}
