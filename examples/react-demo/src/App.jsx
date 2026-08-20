import { useEffect, useRef, useState } from 'react'
import { Quickdraw, useQuickdrawStore } from '@quickdrawjs/react'
import { compileLesson, isLessonDsl } from '@quickdrawjs/lesson-compiler'
import { generateLesson } from './generateLesson.js'
import '@quickdrawjs/core/quickdraw.css'

const STORAGE_KEY = 'quickdraw-react-demo'
const REC_KEY = 'quickdraw-react-demo-recording'
const SIDEBAR_W = 340

const load = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

const loadRecording = () => {
  try {
    const raw = sessionStorage.getItem(REC_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const persistRecording = (baseline, events) => {
  if (!baseline || !events?.length) {
    try { sessionStorage.removeItem(REC_KEY) } catch { /* */ }
    return
  }
  try {
    sessionStorage.setItem(REC_KEY, JSON.stringify({ baseline, events }))
  } catch { /* quota */ }
}

const EMPTY_SNAPSHOT = { document: { store: {} } }

const normalizeDiff = (diff) => ({
  added: diff?.added && typeof diff.added === 'object' && !Array.isArray(diff.added) ? diff.added : {},
  removed: diff?.removed && typeof diff.removed === 'object' && !Array.isArray(diff.removed) ? diff.removed : {},
  updated: diff?.updated && typeof diff.updated === 'object' && !Array.isArray(diff.updated) ? diff.updated : {},
})

/** Accept lesson DSL, full tape, { events }, or a bare events array. */
const parseImportPayload = (raw) => {
  let data
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (e) {
    throw new Error('Invalid JSON: ' + e.message)
  }

  if (isLessonDsl(data)) {
    const tape = compileLesson(data)
    if (!tape.events.length) throw new Error('Lesson compiled to zero events')
    return {
      baseline: structuredClone(tape.baseline),
      events: tape.events.map((ev) => ({ t: ev.t, diff: normalizeDiff(ev.diff) })),
      source: 'lesson',
      scene: tape.scene,
    }
  }

  let baseline = EMPTY_SNAPSHOT
  let list

  if (Array.isArray(data)) {
    list = data
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.events)) {
      list = data.events
      if (data.baseline?.document?.store && typeof data.baseline.document.store === 'object') {
        baseline = data.baseline
      }
    } else {
      throw new Error('Expected lesson DSL { actions }, tape { baseline?, events }, or [{ t, diff }]')
    }
  } else {
    throw new Error('Expected a JSON object or array')
  }

  if (!list.length) throw new Error('No events in import')

  const events = list.map((ev, i) => {
    if (!ev || typeof ev !== 'object') throw new Error(`Event #${i + 1} is not an object`)
    const t = Number(ev.t)
    if (!Number.isFinite(t) || t < 0) throw new Error(`Event #${i + 1}: t must be a non-negative number`)
    if (!ev.diff || typeof ev.diff !== 'object') throw new Error(`Event #${i + 1}: missing diff object`)
    return { t, diff: normalizeDiff(ev.diff) }
  })

  return { baseline: structuredClone(baseline), events, source: 'tape' }
}

const summarizeDiff = (diff) => {
  if (!diff) return 'empty'
  const a = Object.keys(diff.added || {}).length
  const u = Object.keys(diff.updated || {}).length
  const r = Object.keys(diff.removed || {}).length
  const parts = []
  if (a) parts.push(`+${a}`)
  if (u) parts.push(`~${u}`)
  if (r) parts.push(`-${r}`)
  return parts.length ? parts.join(' ') : 'empty'
}

const btnStyle = {
  font: '500 13px system-ui',
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid rgba(0,0,0,0.15)',
  background: '#fff',
  cursor: 'pointer',
}

const smallBtn = {
  ...btnStyle,
  padding: '4px 10px',
  fontSize: 12,
  borderRadius: 6,
}

export default function App() {
  const saved = loadRecording()
  const [theme, setTheme] = useState('light')
  const [grid, setGrid] = useState('lines')
  const [mode, setMode] = useState('idle') // 'idle' | 'recording' | 'playing'
  const [events, setEvents] = useState(() => saved?.events || [])
  const [baseline, setBaseline] = useState(() => saved?.baseline || null)
  const [selected, setSelected] = useState(null) // index | null
  const [editT, setEditT] = useState('')
  const [editJson, setEditJson] = useState('')
  const [editError, setEditError] = useState('')
  const [editOk, setEditOk] = useState('')
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const [importOk, setImportOk] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [showGenerate, setShowGenerate] = useState(false)
  const [genPrompt, setGenPrompt] = useState('draw a tree')
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState('')
  const boardRef = useRef(null)
  const fileInputRef = useRef(null)
  const store = useQuickdrawStore(load())

  const t0Ref = useRef(0)
  const unsubRef = useRef(null)
  const playTimersRef = useRef([])
  const listEndRef = useRef(null)
  const eventsRef = useRef(events)
  const baselineRef = useRef(baseline)
  eventsRef.current = events
  baselineRef.current = baseline

  const hasRecording = !!baseline && events.length > 0
  const canEdit = mode === 'idle' && hasRecording
  const canImport = mode === 'idle'

  // keep editor fields in sync when selection changes (not on every events tweak
  // while the same row stays selected — that would fight the textarea)
  useEffect(() => {
    if (selected == null || !events[selected]) {
      setEditT('')
      setEditJson('')
      setEditError('')
      setEditOk('')
      return
    }
    const ev = events[selected]
    setEditT(String(ev.t))
    setEditJson(JSON.stringify(ev.diff, null, 2))
    setEditError('')
  }, [selected])

  // auto-scroll list while recording
  useEffect(() => {
    if (mode !== 'recording') return
    listEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [events.length, mode])

  // debounced board persistence
  useEffect(() => {
    let t = 0
    const unsub = store.listen(() => {
      clearTimeout(t)
      t = setTimeout(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store.getSnapshot()))
      }, 500)
    })
    return () => { clearTimeout(t); unsub() }
  }, [store])

  const clearPlayTimers = () => {
    for (const id of playTimersRef.current) clearTimeout(id)
    playTimersRef.current = []
  }

  const stopPlayback = () => {
    clearPlayTimers()
    setMode('idle')
  }

  const stopRecording = () => {
    unsubRef.current?.()
    unsubRef.current = null
    persistRecording(baselineRef.current, eventsRef.current)
    setMode('idle')
  }

  const startRecording = () => {
    clearPlayTimers()
    unsubRef.current?.()
    const snap = structuredClone(store.getSnapshot())
    setBaseline(snap)
    setEvents([])
    setSelected(null)
    try { sessionStorage.removeItem(REC_KEY) } catch { /* */ }
    t0Ref.current = Date.now()
    unsubRef.current = store.listen((diff) => {
      setEvents((prev) => {
        const next = [...prev, { t: Date.now() - t0Ref.current, diff }]
        eventsRef.current = next
        return next
      })
    }, { source: 'user' })
    setMode('recording')
  }

  const playRecordingWith = (snap, evs) => {
    if (!snap || !evs?.length) return false

    clearPlayTimers()
    unsubRef.current?.()
    unsubRef.current = null
    setMode('playing')

    store.loadSnapshot(structuredClone(snap), 'remote')

    const sorted = [...evs].sort((a, b) => a.t - b.t)
    for (const { t, diff } of sorted) {
      playTimersRef.current.push(
        setTimeout(() => store.applyDiff(diff, 'remote'), Math.max(0, Number(t) || 0)),
      )
    }
    const endAt = Math.max(0, Number(sorted[sorted.length - 1].t) || 0) + 50
    playTimersRef.current.push(
      setTimeout(() => setMode('idle'), endAt),
    )
    return true
  }

  const playRecording = () => {
    playRecordingWith(baselineRef.current, eventsRef.current)
  }

  const applyEdit = () => {
    if (selected == null || !canEdit) return
    setEditOk('')
    const t = Number(editT)
    if (!Number.isFinite(t) || t < 0) {
      setEditError('t must be a non-negative number (ms from record start)')
      return
    }
    let diff
    try {
      diff = JSON.parse(editJson)
    } catch (e) {
      setEditError('Invalid JSON: ' + e.message)
      return
    }
    if (!diff || typeof diff !== 'object' || Array.isArray(diff)) {
      setEditError('Diff must be a JSON object with added / updated / removed')
      return
    }
    // normalize shape so applyDiff always sees the three maps
    diff = normalizeDiff(diff)
    const idx = selected
    const next = eventsRef.current.map((ev, i) => (i === idx ? { t, diff } : ev))
    eventsRef.current = next
    setEvents(next)
    persistRecording(baselineRef.current, next)
    setEditT(String(t))
    setEditJson(JSON.stringify(diff, null, 2))
    setEditError('')
    setEditOk('Saved — playing…')
    playRecordingWith(baselineRef.current, next)
  }

  const deleteSelected = () => {
    if (selected == null || !canEdit) return
    setEvents((prev) => {
      const next = prev.filter((_, i) => i !== selected)
      persistRecording(baseline, next)
      return next
    })
    setSelected(null)
  }

  const loadImported = (payload, { play = false } = {}) => {
    const { baseline: snap, events: evs, source, scene } = payload
    baselineRef.current = snap
    eventsRef.current = evs
    setBaseline(snap)
    setEvents(evs)
    setSelected(null)
    persistRecording(snap, evs)
    setImportError('')
    const kind = source === 'lesson' ? `lesson${scene ? ` "${scene}"` : ''}` : 'tape'
    setImportOk(`Loaded ${evs.length} transaction${evs.length === 1 ? '' : 's'} from ${kind}`)
    if (play) playRecordingWith(snap, evs)
  }

  const importFromText = ({ play = false } = {}) => {
    if (!canImport) return
    setImportOk('')
    try {
      const payload = parseImportPayload(importText)
      loadImported(payload, { play })
    } catch (e) {
      setImportError(e.message || String(e))
    }
  }

  const importFromFile = async (file) => {
    if (!canImport || !file) return
    setImportOk('')
    try {
      const text = await file.text()
      setImportText(text)
      const payload = parseImportPayload(text)
      loadImported(payload, { play: false })
      setShowImport(true)
    } catch (e) {
      setImportError(e.message || String(e))
      setShowImport(true)
    }
  }

  const exportTape = async () => {
    if (!hasRecording) return
    const tape = JSON.stringify(
      { baseline: baselineRef.current, events: eventsRef.current },
      null,
      2,
    )
    setImportText(tape)
    setShowImport(true)
    try {
      await navigator.clipboard.writeText(tape)
      setImportOk('Copied tape JSON to clipboard')
      setImportError('')
    } catch {
      setImportOk('Tape shown below — copy manually')
      setImportError('')
    }
  }

  const runGenerateAndPlay = async () => {
    const prompt = genPrompt.trim()
    if (!prompt || genBusy || mode === 'recording' || mode === 'playing') return
    setGenBusy(true)
    setGenError('')
    try {
      const lesson = await generateLesson(prompt)
      const dslText = JSON.stringify(lesson, null, 2)
      setImportText(dslText)
      setShowImport(true)
      const payload = parseImportPayload(lesson)
      loadImported(payload, { play: true })
      setShowGenerate(false)
    } catch (e) {
      setGenError(e.message || String(e))
    } finally {
      setGenBusy(false)
    }
  }

  // cleanup on unmount
  useEffect(() => () => {
    unsubRef.current?.()
    clearPlayTimers()
  }, [])

  const statusLabel =
    mode === 'recording' ? 'Recording…' : mode === 'playing' ? 'Playing…' : 'Idle'

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex' }}>
      <aside
        style={{
          width: SIDEBAR_W,
          flexShrink: 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid rgba(0,0,0,0.12)',
          background: '#f7f7f5',
          fontFamily: 'system-ui, sans-serif',
          zIndex: 40,
        }}
      >
        <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
          <div style={{ font: '600 14px system-ui', marginBottom: 4 }}>Transactions</div>
          <div style={{ font: '12px system-ui', opacity: 0.65 }}>
            {mode === 'recording'
              ? 'Capturing live…'
              : canEdit
                ? 'Edit, import bulk JSON, or Play'
                : hasRecording
                  ? 'Stop play to edit'
                  : 'Record or import a tape'}
          </div>
          <div style={{ font: '12px system-ui', marginTop: 6, opacity: 0.8 }}>
            {events.length} event{events.length === 1 ? '' : 's'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            <button
              type="button"
              style={smallBtn}
              disabled={!canImport}
              onClick={() => { setShowImport((v) => !v); setImportError(''); setImportOk('') }}
            >
              {showImport ? 'Hide import' : 'Import'}
            </button>
            <button
              type="button"
              style={smallBtn}
              disabled={!canImport}
              onClick={() => fileInputRef.current?.click()}
            >
              Upload JSON
            </button>
            <button
              type="button"
              style={smallBtn}
              disabled={!hasRecording || mode !== 'idle'}
              onClick={exportTape}
            >
              Export
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) importFromFile(f)
              }}
            />
          </div>
        </div>

        {showImport && (
          <div
            style={{
              padding: 12,
              borderBottom: '1px solid rgba(0,0,0,0.1)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              background: '#fff',
            }}
          >
            <div style={{ font: '11px system-ui', opacity: 0.7 }}>
              Paste a <strong>lesson DSL</strong> (<code>{'{ actions }'}</code>), a full tape{' '}
              <code>{'{ baseline, events }'}</code>, or <code>{'[{ t, diff }, …]'}</code>.
              DSL is compiled automatically.
            </div>
            <textarea
              value={importText}
              disabled={!canImport}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={'{\n  "baseline": { "document": { "store": {} } },\n  "events": [ { "t": 0, "diff": { ... } } ]\n}'}
              spellCheck={false}
              style={{
                minHeight: 110,
                resize: 'vertical',
                font: '11px ui-monospace, Menlo, monospace',
                padding: 8,
                borderRadius: 6,
                border: '1px solid rgba(0,0,0,0.18)',
                lineHeight: 1.35,
              }}
            />
            {importError && (
              <div style={{ font: '11px system-ui', color: '#b91c1c' }}>{importError}</div>
            )}
            {importOk && !importError && (
              <div style={{ font: '11px system-ui', color: '#15803d' }}>{importOk}</div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={smallBtn}
                disabled={!canImport || !importText.trim()}
                onClick={() => importFromText({ play: false })}
              >
                Load
              </button>
              <button
                type="button"
                style={{ ...smallBtn, background: '#e8eef9' }}
                disabled={!canImport || !importText.trim()}
                onClick={() => importFromText({ play: true })}
              >
                Load & Play
              </button>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {events.length === 0 ? (
            <div style={{ padding: 14, font: '12px system-ui', opacity: 0.55 }}>
              No transactions yet. Record, or Import / Upload JSON.
            </div>
          ) : (
            events.map((ev, i) => {
              const on = selected === i
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected(i)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 14px',
                    border: 'none',
                    borderBottom: '1px solid rgba(0,0,0,0.06)',
                    background: on ? '#e8eef9' : 'transparent',
                    cursor: 'pointer',
                    font: '12px ui-monospace, Menlo, monospace',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>#{i + 1}</span>
                    <span style={{ opacity: 0.7 }}>{ev.t}ms</span>
                  </div>
                  <div style={{ marginTop: 2, opacity: 0.75 }}>{summarizeDiff(ev.diff)}</div>
                </button>
              )
            })
          )}
          <div ref={listEndRef} />
        </div>

        {selected != null && events[selected] && (
          <div
            style={{
              borderTop: '1px solid rgba(0,0,0,0.12)',
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxHeight: '48%',
              background: '#fff',
            }}
          >
            <div style={{ font: '600 12px system-ui' }}>
              Edit #{selected + 1}
              {!canEdit && (
                <span style={{ fontWeight: 400, opacity: 0.6 }}> (read-only while {mode})</span>
              )}
            </div>
            <label style={{ font: '11px system-ui', display: 'flex', flexDirection: 'column', gap: 4 }}>
              t (ms from start)
              <input
                type="number"
                min={0}
                value={editT}
                disabled={!canEdit}
                onChange={(e) => setEditT(e.target.value)}
                style={{
                  font: '12px ui-monospace, Menlo, monospace',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(0,0,0,0.18)',
                }}
              />
            </label>
            <label style={{ font: '11px system-ui', display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minHeight: 0 }}>
              diff (JSON)
              <textarea
                value={editJson}
                disabled={!canEdit}
                onChange={(e) => setEditJson(e.target.value)}
                spellCheck={false}
                style={{
                  flex: 1,
                  minHeight: 120,
                  resize: 'vertical',
                  font: '11px ui-monospace, Menlo, monospace',
                  padding: 8,
                  borderRadius: 6,
                  border: '1px solid rgba(0,0,0,0.18)',
                  lineHeight: 1.35,
                }}
              />
            </label>
            {editError && (
              <div style={{ font: '11px system-ui', color: '#b91c1c' }}>{editError}</div>
            )}
            {editOk && !editError && (
              <div style={{ font: '11px system-ui', color: '#15803d' }}>{editOk}</div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={smallBtn} disabled={!canEdit} onClick={applyEdit}>
                Apply & Play
              </button>
              <button
                type="button"
                style={{ ...smallBtn, background: '#fee2e2' }}
                disabled={!canEdit}
                onClick={deleteSelected}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </aside>

      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <Quickdraw
          ref={boardRef}
          store={store}
          theme={theme}
          grid={grid}
          readonly={mode === 'playing'}
          autoFit={false}
          onThemeChange={setTheme}
          onGridChange={setGrid}
          onMount={(editor) => {
            if (store.size) editor.fitContent()
            window.editor = editor
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ font: '500 12px system-ui', opacity: 0.65 }}>
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={() => { setShowGenerate(true); setGenError('') }}
            disabled={mode === 'recording' || mode === 'playing' || genBusy}
            style={{
              ...btnStyle,
              background: '#e8eef9',
              cursor: (mode === 'recording' || mode === 'playing' || genBusy) ? 'not-allowed' : 'pointer',
              opacity: (mode === 'recording' || mode === 'playing' || genBusy) ? 0.5 : 1,
            }}
          >
            Generate
          </button>
          <button
            type="button"
            onClick={() => (mode === 'recording' ? stopRecording() : startRecording())}
            disabled={mode === 'playing'}
            style={{
              ...btnStyle,
              background: mode === 'recording' ? '#fee2e2' : '#fff',
              cursor: mode === 'playing' ? 'not-allowed' : 'pointer',
              opacity: mode === 'playing' ? 0.5 : 1,
            }}
          >
            {mode === 'recording' ? 'Stop' : 'Record'}
          </button>
          <button
            type="button"
            onClick={() => (mode === 'playing' ? stopPlayback() : playRecording())}
            disabled={mode === 'recording' || (!hasRecording && mode !== 'playing')}
            style={{
              ...btnStyle,
              cursor: (mode === 'recording' || (!hasRecording && mode !== 'playing'))
                ? 'not-allowed'
                : 'pointer',
              opacity: (mode === 'recording' || (!hasRecording && mode !== 'playing')) ? 0.5 : 1,
            }}
          >
            {mode === 'playing' ? 'Stop play' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            style={btnStyle}
          >
            {theme === 'light' ? 'dark' : 'light'}
          </button>
        </div>

        {showGenerate && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Generate lesson from prompt"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 60,
              background: 'rgba(0,0,0,0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
            onClick={() => { if (!genBusy) setShowGenerate(false) }}
          >
            <div
              style={{
                width: 'min(480px, 100%)',
                background: '#fff',
                borderRadius: 12,
                padding: 20,
                boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
                fontFamily: 'system-ui, sans-serif',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ font: '600 16px system-ui' }}>Generate lesson</div>
              <div style={{ font: '13px system-ui', opacity: 0.7 }}>
                Describe what to draw. The LLM returns Educational DSL; we compile and play it.
              </div>
              <textarea
                value={genPrompt}
                onChange={(e) => setGenPrompt(e.target.value)}
                disabled={genBusy}
                placeholder="draw a tree"
                rows={4}
                style={{
                  width: '100%',
                  resize: 'vertical',
                  font: '14px system-ui',
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid rgba(0,0,0,0.18)',
                  boxSizing: 'border-box',
                }}
              />
              {genError && (
                <div style={{ font: '12px system-ui', color: '#b91c1c' }}>{genError}</div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  style={smallBtn}
                  disabled={genBusy}
                  onClick={() => setShowGenerate(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  style={{ ...smallBtn, background: '#e8eef9' }}
                  disabled={genBusy || !genPrompt.trim()}
                  onClick={runGenerateAndPlay}
                >
                  {genBusy ? 'Generating…' : 'Generate & Play'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
