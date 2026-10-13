import { getErrorMessage } from '../../utils/errors'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { getWheelData, addCategories, addPerson } from '../../api'
import type { WheelData, WheelEntry, HistoryEntry } from '../../api'
import DrawWheel from './DrawWheel'
import './WheelPage.css'

type View = 'wheel' | 'addCats' | 'history'

// ── History view ────────────────────────────────────────────────────────────
function HistoryView({ history, entries }: { history: HistoryEntry[]; entries: WheelEntry[] }) {
  const keyToName = Object.fromEntries(entries.map(e => [e.key, e.name]))
  const counts: Record<string, number> = {}
  for (const h of history) {
    const name = keyToName[h.person] ?? h.person
    counts[name] = (counts[name] ?? 0) + 1
  }
  const sortedPeople = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const reversed = [...history].reverse()

  return (
    <div className="wheel-history-view">
      <div className="wh-summary">
        <span className="wh-total">🎰 {history.length} losowań łącznie</span>
        <div className="wh-person-counts">
          {sortedPeople.map(([name, count]) => (
            <span key={name} className="wh-person-count-chip">
              {name} <strong>{count}</strong>
            </span>
          ))}
        </div>
      </div>
      <div className="history-panel">
        <div className="history-title">Chronologia (od najnowszego)</div>
        {history.length === 0 ? (
          <div className="cat-modal-empty">Brak historii</div>
        ) : (
          <div className="history-list">
            {reversed.map((h, i) => (
              <div key={h.row_index} className="history-item">
                <span className="history-num">{history.length - i}</span>
                <span className="history-person">{keyToName[h.person] ?? h.person}</span>
                <span className="history-cat">{h.category}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Categories modal ────────────────────────────────────────────────────────
function CategoriesModal({ entry, onClose }: { entry: WheelEntry; onClose: () => void }) {
  return (
    <motion.div
      className="cat-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="cat-modal"
        initial={{ scale: 0.85, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.85, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="cat-modal-header">
          <div className="cat-modal-name">{entry.name}</div>
          <span className="cat-modal-count">{entry.categories.length} kategorii</span>
          <button className="cat-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="cat-modal-list">
          {entry.categories.length === 0 ? (
            <div className="cat-modal-empty">Brak kategorii</div>
          ) : (
            entry.categories.map((c, i) => (
              <div key={i} className="cat-modal-item">
                <span className="cat-modal-num">{i + 1}</span>
                <span className="cat-modal-text">{c}</span>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

export default function WheelPage() {
  const nav = useNavigate()
  const [data, setData] = useState<WheelData | null>(null)
  const [view, setView] = useState<View>('addCats')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(() => {
    getWheelData().then(d => { setData(d); setError('') })
      .catch(() => setError('Nie udało się odświeżyć koła.'))
  }, [])

  useEffect(() => {
    getWheelData().then(d => {
      setData(d)
      if (d.active_draw?.pending) setView('wheel')
    }).catch(() => setError('Nie można załadować danych.'))
  }, [])

  if (!data) return error
    ? <div className="error-msg">{error}<button className="btn" onClick={reload}>Spróbuj ponownie</button></div>
    : <div className="loading"><div className="spinner" /><span>Ładowanie…</span></div>

  return (
    <div className="wheel-page">
      <div className="page-header">
        <button className="back-btn" disabled={busy} onClick={() => nav('/')}>← Wróć</button>
        <span className="page-title">Kręć kołem! 🎡</span>
        <div className="wheel-header-btns">
          {view !== 'history' && <button className="btn btn-ghost btn-sm" disabled={busy}
            onClick={() => setView('history')}>📜 Historia</button>}
          <button className="btn btn-secondary btn-sm" disabled={busy}
            onClick={() => setView(v => v === 'wheel' ? 'addCats' : 'wheel')}>
            {view === 'wheel' ? '+ Kategorie' : '← Koło'}
          </button>
        </div>
      </div>
      {error && <div className="error-msg" role="alert">{error}</div>}
      {view === 'history' && <HistoryView history={data.history} entries={data.entries} />}
      {view === 'addCats' && <AddCategoriesView entries={data.entries}
        onGoToWheel={() => { reload(); setView('wheel') }} onReload={reload} />}
      {view === 'wheel' && <DrawWheel data={data} onReload={reload} onBusy={setBusy} onScoring={() => nav('/scoring')} />}
    </div>
  )
}

// ── Add Categories View ─────────────────────────────────────────────────────
function AddCategoriesView({ entries, onGoToWheel, onReload }: {
  entries: WheelEntry[]
  /** Leaves this view for the wheel. Only the footer button may call it --
   *  adding a person or a category must never navigate, because the person who
   *  was just added still has to type their categories. */
  onGoToWheel: () => void
  /** Refreshes the grid in place, keeping this view mounted. */
  onReload: () => void
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({})
  const [toasts, setToasts] = useState<Record<string, string>>({})
  const [modalEntry, setModalEntry] = useState<WheelEntry | null>(null)
  const [newPersonName, setNewPersonName] = useState('')
  const [addingPerson, setAddingPerson] = useState(false)
  const [addPersonMsg, setAddPersonMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [justAdded, setJustAdded] = useState<string | null>(null)

  // Once the reload brings the new person's card in, scroll to it and put the
  // cursor in their category box.
  useEffect(() => {
    if (!justAdded) return
    const entry = entries.find(e => e.name.toLowerCase() === justAdded.toLowerCase())
    if (!entry) return
    const input = Array.from(document.querySelectorAll<HTMLInputElement>('[data-cat-input]'))
      .find(el => el.dataset.catInput === entry.key)
    input?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    input?.focus()
    setJustAdded(null)
  }, [entries, justAdded])

  const timers = useRef<Record<string, number>>({})
  useEffect(() => {
    const t = timers.current
    return () => { Object.values(t).forEach(id => window.clearTimeout(id)) }
  }, [])

  // Green confirmation pill pinned inside that person's own card, gone after 5s.
  const flashToast = (key: string, text: string) => {
    window.clearTimeout(timers.current[key])
    setToasts(t => ({ ...t, [key]: text }))
    timers.current[key] = window.setTimeout(() => {
      setToasts(t => {
        const next = { ...t }
        delete next[key]
        return next
      })
    }, 5000)
  }

  const handleAdd = async (key: string) => {
    const val = (inputs[key] ?? '').trim()
    if (!val) return
    setSavingKey(key)
    setErrors(e => ({ ...e, [key]: '' }))
    try {
      await addCategories({ [key]: [val] })
      setInputs(i => ({ ...i, [key]: '' }))
      setSavedKeys(s => ({ ...s, [key]: true }))
      setTimeout(() => setSavedKeys(s => ({ ...s, [key]: false })), 2000)
      flashToast(key, `✓ Dodano „${val}”`)
      // Refresh counts/probabilities so the card stops reading "0 / brak kategorii".
      onReload()
    } catch (e) {
      setErrors(err => ({ ...err, [key]: getErrorMessage(e, 'Błąd') }))
    } finally {
      setSavingKey(null)
    }
  }

  const handleAddPerson = async () => {
    const name = newPersonName.trim()
    if (!name || addingPerson) return
    setAddingPerson(true)
    setAddPersonMsg(null)
    try {
      await addPerson(name)
      setNewPersonName('')
      setAddPersonMsg({ ok: true, text: `✅ Dodano: ${name} — wpisz jego kategorie poniżej` })
      // Stay on the grid: the whole point of adding someone here is that they
      // now type their categories.
      setJustAdded(name)
      onReload()
    } catch (e) {
      setAddPersonMsg({ ok: false, text: getErrorMessage(e, 'Błąd dodawania') })
    } finally {
      setAddingPerson(false)
    }
  }

  return (
    <>
      <div className="add-cats-view">
        <h2 className="section-h2">Dodaj kategorie</h2>
        <div className="add-cats-grid">
          {entries.map(entry => (
            <div
              key={entry.key}
              className={`add-cat-person${entry.categories.length === 0 ? ' is-empty' : ''}`}
            >
              <AnimatePresence>
                {toasts[entry.key] && (
                  <motion.div
                    className="add-cat-toast"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: 0.6 } }}
                  >
                    {toasts[entry.key]}
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="add-cat-header">
                <button
                  className="add-cat-name-btn"
                  onClick={() => setModalEntry(entry)}
                  title="Zobacz wszystkie kategorie"
                >
                  {entry.name}
                  <span className="add-cat-count">{entry.count}</span>
                </button>
                <span
                  className="prob-badge"
                  title={`Prawdopodobieństwo wylosowania: ${(entry.probability * 100).toFixed(1)}%`}
                >
                  {(entry.probability * 100).toFixed(0)}%
                </span>
              </div>

              <div className="add-cat-row">
                <input
                  type="text"
                  data-cat-input={entry.key}
                  placeholder="Nowa kategoria…"
                  value={inputs[entry.key] ?? ''}
                  onChange={e => setInputs(i => ({ ...i, [entry.key]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleAdd(entry.key) }}
                />
                <button
                  className={`btn btn-sm ${savedKeys[entry.key] ? 'btn-success' : 'btn-primary'}`}
                  disabled={savingKey === entry.key || !(inputs[entry.key] ?? '').trim()}
                  onClick={() => handleAdd(entry.key)}
                >
                  {savedKeys[entry.key] ? '✓' : '+'}
                </button>
              </div>
              {entry.categories.length === 0 && (
                <div className="add-cat-empty-hint">brak kategorii — dodaj pierwszą</div>
              )}
              {errors[entry.key] && (
                <div style={{ color: 'var(--error)', fontSize: '0.78rem', marginTop: 4 }}>{errors[entry.key]}</div>
              )}
            </div>
          ))}
        </div>
        <div className="add-person-section">
          <h3 className="add-person-heading">Dodaj nową osobę</h3>
          <div className="add-person-row">
            <input
              type="text"
              placeholder="Imię nowej osoby…"
              value={newPersonName}
              onChange={e => setNewPersonName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddPerson() }}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={addingPerson || !newPersonName.trim()}
              onClick={handleAddPerson}
            >
              {addingPerson ? '…' : 'Dodaj'}
            </button>
          </div>
          {addPersonMsg && (
            <div className={addPersonMsg.ok ? 'add-person-ok' : 'error-msg'} style={{ fontSize: '0.82rem', marginTop: 6 }}>
              {addPersonMsg.text}
            </div>
          )}


        </div>

        <div className="add-cats-footer">
          <button className="btn btn-primary" onClick={onGoToWheel}>Przejdź do koła →</button>
        </div>
      </div>

      <AnimatePresence>
        {modalEntry && (
          <CategoriesModal entry={modalEntry} onClose={() => setModalEntry(null)} />
        )}
      </AnimatePresence>
    </>
  )
}
