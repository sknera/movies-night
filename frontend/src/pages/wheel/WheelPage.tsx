import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import confetti from 'canvas-confetti'
import { getWheelData, addCategories, addPerson, recordSpin, deleteLastSpin, getWheelCandidates, resurfacePerson } from '../../api'
import type { WheelData, WheelEntry, HistoryEntry, NextCategory, WheelCandidate } from '../../api'
import CasinoWheel from '../../components/CasinoWheel'
import './WheelPage.css'

interface CategorySlot {
  category: string
  personName: string
  personKey: string
  weight: number
}

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
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('addCats')
  const [spinning, setSpinning] = useState(false)
  const [targetIdx, setTargetIdx] = useState<number | null>(null)
  const [result, setResult] = useState<{ category: string; personName: string; personKey: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [undone, setUndone] = useState(false)
  const [nextCategory, setNextCategory] = useState<NextCategory | null>(null)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  const [undoNote, setUndoNote] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    getWheelData().then(d => {
      setData(d)
      setNextCategory(d.next_category)
    }).finally(() => setLoading(false))
  }, [])

  // Refresh without flipping `loading`: the spinner would unmount the add-cats
  // grid and take its confirmation toast with it.
  const reloadQuiet = useCallback(() => {
    getWheelData().then(d => {
      setData(d)
      setNextCategory(d.next_category)
    })
  }, [])

  useEffect(() => { reload() }, [reload])

  const slots = useMemo((): CategorySlot[] => {
    if (!data) return []
    return data.entries.flatMap(entry =>
      entry.categories.map(cat => ({
        category: cat,
        personName: entry.name,
        personKey: entry.key,
        weight: entry.probability / Math.max(1, entry.categories.length),
      }))
    )
  }, [data])

  const shuffledIndices = useMemo(() => {
    const indices = Array.from({ length: slots.length }, (_, i) => i)
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[indices[i], indices[j]] = [indices[j], indices[i]]
    }
    return indices
  }, [slots])

  const wheelItems = useMemo(
    () => shuffledIndices.map(i => slots[i].category),
    [shuffledIndices, slots]
  )

  const pickWinner = useCallback((slots: CategorySlot[]) => {
    const total = slots.reduce((s, c) => s + c.weight, 0)
    let rand = Math.random() * total
    for (let i = 0; i < slots.length; i++) {
      rand -= slots[i].weight
      if (rand <= 0) return i
    }
    return slots.length - 1
  }, [])

  const doSpin = useCallback(() => {
    let slotIdx: number
    const fs = data?.forced_spin
    if (fs) {
      const forced = slots.findIndex(s => s.personKey === fs.person_key && s.category === fs.category)
      slotIdx = forced !== -1 ? forced : pickWinner(slots)
    } else {
      slotIdx = pickWinner(slots)
    }
    const wheelIdx = shuffledIndices.indexOf(slotIdx)
    setTargetIdx(wheelIdx !== -1 ? wheelIdx : 0)
    setSpinning(true)
    setResult(null)
    setSaved(false)
    setSaveError(null)
  }, [slots, shuffledIndices, pickWinner, data])

  const handleSpin = () => {
    if (spinning || slots.length === 0) return
    if (nextCategory && !data?.forced_spin && !confirmOverwrite) {
      setConfirmOverwrite(true)
      return
    }
    setConfirmOverwrite(false)
    doSpin()
  }

  const handleAnimationEnd = useCallback(() => {
    if (targetIdx === null) return
    const slot = slots[shuffledIndices[targetIdx]]
    const spinResult = { category: slot.category, personName: slot.personName, personKey: slot.personKey }
    setResult(spinResult)
    setSpinning(false)
    setSaving(true)

    recordSpin(spinResult.personKey, spinResult.category)
      .then(() => { setSaved(true); reload() })
      .catch((e: any) => setSaveError(e?.response?.data?.detail || 'Błąd zapisu'))
      .finally(() => setSaving(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    setTimeout(() => {
      confetti({ particleCount: 180, spread: 80, origin: { y: 0.5 }, colors: ['#674EA7', '#B4A7D6', '#ffffff', '#A383DA', '#5E3A8C'], ticks: 300 })
      confetti({ particleCount: 80, angle: 60, spread: 55, origin: { x: 0 }, colors: ['#674EA7', '#B4A7D6', '#ffffff'] })
      confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 1 }, colors: ['#674EA7', '#B4A7D6', '#ffffff'] })
    }, 100)
  }, [targetIdx, slots, shuffledIndices, reload])

  const handleNewSpin = () => {
    setResult(null)
    setTargetIdx(null)
    setSaved(false)
    setSaveError(null)
    setUndone(false)
    setUndoNote(null)
  }

  const handleUnsave = async () => {
    setUndoing(true)
    try {
      const res = await deleteLastSpin()
      setUndone(true)
      setSaved(false)
      setUndoNote(
        res.category_restored
          ? `Kategoria „${res.removed.category}” wróciła na koło`
          : `Kategoria „${res.removed.category}” była już na kole`
      )
      reload()
    } catch (e: any) {
      setSaveError(e?.response?.data?.detail || 'Nie udało się cofnąć losowania')
    } finally {
      setUndoing(false)
    }
  }

  if (loading) return <div className="loading"><div className="spinner" /><span>Ładowanie…</span></div>
  if (!data) return <div className="error-msg">Nie można załadować danych</div>

  return (
    <div className="wheel-page">
      <div className="page-header">
        <button className="back-btn" onClick={() => nav('/')}>← Wróć</button>
        <span className="page-title">Kręć kołem! 🎡</span>
        <div className="wheel-header-btns">
          {view !== 'history' && (
            <button className="btn btn-ghost btn-sm" onClick={() => setView('history')}>📜 Historia</button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => setView(v => (v === 'addCats' || v === 'history') ? 'wheel' : 'addCats')}>
            {view === 'addCats' || view === 'history' ? '← Koło' : '+ Kategorie'}
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {view === 'history' && (
          <motion.div key="history" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <HistoryView history={data.history} entries={data.entries} />
          </motion.div>
        )}

        {view === 'addCats' && (
          <motion.div key="addcats" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <AddCategoriesView
              entries={data.entries}
              onGoToWheel={() => { reload(); setView('wheel') }}
              onReload={reloadQuiet}
            />
          </motion.div>
        )}

        {view === 'wheel' && (
          <motion.div key="wheel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="wheel-main">
            <div className="wheel-area">
              <CasinoWheel
                items={wheelItems}
                spinning={spinning}
                targetIndex={targetIdx}
                onAnimationEnd={handleAnimationEnd}
              />
              <button
                className={`spin-btn ${spinning ? 'spin-btn-spinning' : ''}`}
                onClick={handleSpin}
                disabled={spinning || slots.length === 0}
              >
                {spinning ? '…' : 'KRĘĆ!'}
              </button>
            </div>

            <div className="wheel-right">
              <AnimatePresence mode="wait">
                {confirmOverwrite && nextCategory && (
                  <motion.div
                    key="confirm"
                    className="spin-confirm"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                  >
                    <div className="spin-confirm-label">Kategoria już jest ustawiona:</div>
                    <div className="spin-confirm-cat">{nextCategory.category}</div>
                    {nextCategory.person && (
                      <div className="spin-confirm-person">zaproponowane przez <strong>{nextCategory.person}</strong></div>
                    )}
                    <div className="spin-confirm-question">Na pewno wylosować nową?</div>
                    <div className="spin-confirm-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setConfirmOverwrite(false)}>
                        Anuluj
                      </button>
                      <button className="btn btn-primary btn-sm" onClick={() => { setConfirmOverwrite(false); doSpin() }}>
                        Tak, losuj nową
                      </button>
                    </div>
                  </motion.div>
                )}
                {!confirmOverwrite && result && (
                  <motion.div
                    key="result"
                    className="result-card"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                  >
                    <div className="result-label">Wylosowano!</div>
                    <div className="result-category">{result.category}</div>
                    <div className="result-divider">zaproponowane przez</div>
                    <div className="result-person">{result.personName}</div>

                    {saving && <div className="saving-indicator">Zapisuję…</div>}
                    {saved && !undone && <div className="saved-ok">✅ Zapisano!</div>}
                    {undone && (
                      <div className="unsave-ok">
                        🗑 Nie zapisano
                        {undoNote && <div className="unsave-note">{undoNote}</div>}
                      </div>
                    )}
                    {saveError && (
                      <div className="error-msg" style={{ marginTop: 8 }}>{saveError}</div>
                    )}

                    {saved && !undone && (
                      <button
                        className="btn btn-ghost btn-sm unsave-btn"
                        onClick={handleUnsave}
                        disabled={undoing}
                      >
                        {undoing ? '…' : 'Nie zapisuj'}
                      </button>
                    )}

                    <button className="btn btn-ghost btn-sm" onClick={handleNewSpin} style={{ marginTop: 4 }}>
                      Zakręć ponownie
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => nav('/scoring')} style={{ marginTop: 4 }}>
                      Przejdź do oceniania →
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Re-surface person modal ─────────────────────────────────────────────────
function ResurfacePersonModal({
  onClose,
  onAdded,
}: {
  onClose: () => void
  onAdded: (name: string) => void
}) {
  const [candidates, setCandidates] = useState<WheelCandidate[] | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getWheelCandidates()
      .then(setCandidates)
      .catch(() => setError('Nie udało się pobrać listy osób'))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!candidates) return []
    if (!q) return candidates
    return candidates.filter(c => c.name.toLowerCase().includes(q))
  }, [candidates, query])

  const handlePick = async (name: string) => {
    if (busy) return
    setBusy(name)
    setError('')
    try {
      await resurfacePerson(name)
      onAdded(name)
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Błąd dodawania')
      setBusy(null)
    }
  }

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
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="cat-modal-header">
          <div className="cat-modal-name">Często pojawiające się osoby</div>
          <button className="cat-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="resurface-search">
          <input
            type="text"
            autoFocus
            placeholder="Szukaj imienia…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        {error && <div className="resurface-error">{error}</div>}

        <div className="cat-modal-list">
          {candidates === null ? (
            <div className="cat-modal-empty">Ładowanie…</div>
          ) : filtered.length === 0 ? (
            <div className="cat-modal-empty">Brak pasujących osób</div>
          ) : (
            <div className="resurface-chips">
              {filtered.map(c => (
                <button
                  key={c.name}
                  className="resurface-chip"
                  disabled={busy !== null}
                  onClick={() => handlePick(c.name)}
                  title="Dodaj z powrotem do koła"
                >
                  {busy === c.name ? '…' : c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
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
  const [resurfaceOpen, setResurfaceOpen] = useState(false)
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
    } catch (e: any) {
      setErrors(err => ({ ...err, [key]: e?.response?.data?.detail || 'Błąd' }))
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
    } catch (e: any) {
      setAddPersonMsg({ ok: false, text: e?.response?.data?.detail || 'Błąd dodawania' })
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

          <button
            className="btn btn-secondary btn-sm resurface-btn"
            onClick={() => setResurfaceOpen(true)}
          >
            ↩ Dodaj do często pojawiających się osób
          </button>
          <div className="resurface-hint">
            Przywróć kogoś, kto bywał wcześniej, a teraz nie ma go na kole.
          </div>
        </div>

        <div className="add-cats-footer">
          <button className="btn btn-primary" onClick={onGoToWheel}>Przejdź do koła →</button>
        </div>
      </div>

      <AnimatePresence>
        {modalEntry && (
          <CategoriesModal entry={modalEntry} onClose={() => setModalEntry(null)} />
        )}
        {resurfaceOpen && (
          <ResurfacePersonModal
            onClose={() => setResurfaceOpen(false)}
            onAdded={name => {
              setAddPersonMsg({ ok: true, text: `✅ Przywrócono: ${name}` })
              onReload()
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
