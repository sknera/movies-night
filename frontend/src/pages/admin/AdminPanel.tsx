import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import {
  adminLogin, adminLogout, adminGetPeople,
  adminAddPerson, adminHidePerson, adminShowPerson,
  adminDeleteCategory, adminDeleteHistoryEntry,
  adminEditHistoryEntry, adminReorderHistory, adminAddHistoryEntry,
  addCategories, getWheelData, getNextNightDate, adminSetNextNightDate,
  adminSetNextCategory, adminClearNextCategory, simulateSpins,
  getNights, adminDeleteNight,
} from '../../api'
import type { AdminPerson, WheelEntry, HistoryEntry, ForcedSpin, NightSummary } from '../../api'
import './AdminPanel.css'

// ── Spin History Editor ────────────────────────────────────────────────────

function SpinHistoryEditor({ history, token, onChanged, onFlash }: {
  history: HistoryEntry[]
  token: string
  onChanged: () => void
  onFlash: (msg: string) => void
}) {
  const [items, setItems] = useState<HistoryEntry[]>(history)
  const [orderDirty, setOrderDirty] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [editingRow, setEditingRow] = useState<number | null>(null)
  const [editPerson, setEditPerson] = useState('')
  const [editCat, setEditCat] = useState('')
  const [saving, setSaving] = useState(false)
  const [newPerson, setNewPerson] = useState('')
  const [newCat, setNewCat] = useState('')
  const [adding, setAdding] = useState(false)

  // Keep in sync when history prop changes (after reload)
  useEffect(() => {
    setItems(history)
    setOrderDirty(false)
    setEditingRow(null)
  }, [history])

  const startEdit = (entry: HistoryEntry) => {
    setEditingRow(entry.row_index)
    setEditPerson(entry.person)
    setEditCat(entry.category)
  }

  const cancelEdit = () => setEditingRow(null)

  const saveEdit = async (row_index: number) => {
    if (!editPerson.trim() || !editCat.trim()) return
    setSaving(true)
    try {
      await adminEditHistoryEntry(row_index, editPerson.trim(), editCat.trim(), token)
      onFlash(`✅ Zaktualizowano wpis`)
      setEditingRow(null)
      onChanged()
    } catch (e: any) {
      onFlash(`❌ ${e?.response?.data?.detail || 'Błąd zapisu'}`)
    } finally {
      setSaving(false)
    }
  }

  const deleteEntry = async (row_index: number, label: string) => {
    try {
      await adminDeleteHistoryEntry(row_index, token)
      onFlash(`🗑 Usunięto: ${label}`)
      onChanged()
    } catch (e: any) {
      onFlash(`❌ ${e?.response?.data?.detail || 'Błąd usuwania'}`)
    }
  }

  const saveOrder = async () => {
    setSavingOrder(true)
    try {
      await adminReorderHistory(items.map(i => i.row_index), token)
      onFlash(`✅ Kolejność zapisana`)
      setOrderDirty(false)
      onChanged()
    } catch (e: any) {
      onFlash(`❌ ${e?.response?.data?.detail || 'Błąd zapisu kolejności'}`)
    } finally {
      setSavingOrder(false)
    }
  }

  const resetOrder = () => {
    setItems(history)
    setOrderDirty(false)
  }

  const addEntry = async () => {
    if (!newPerson.trim() || !newCat.trim()) return
    setAdding(true)
    try {
      await adminAddHistoryEntry(newPerson.trim(), newCat.trim(), token)
      onFlash(`✅ Dodano: ${newPerson.trim()} — ${newCat.trim()}`)
      setNewPerson('')
      setNewCat('')
      onChanged()
    } catch (e: any) {
      onFlash(`❌ ${e?.response?.data?.detail || 'Błąd dodawania'}`)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div>
      <div className="sh-add-row">
        <input
          className="sh-input"
          value={newPerson}
          onChange={e => setNewPerson(e.target.value)}
          placeholder="Klucz osoby…"
          onKeyDown={e => e.key === 'Enter' && addEntry()}
        />
        <input
          className="sh-input sh-input-cat"
          value={newCat}
          onChange={e => setNewCat(e.target.value)}
          placeholder="Kategoria…"
          onKeyDown={e => e.key === 'Enter' && addEntry()}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={addEntry}
          disabled={adding || !newPerson.trim() || !newCat.trim()}
        >
          {adding ? '…' : '+ Dodaj'}
        </button>
      </div>

      {orderDirty && (
        <div className="sh-order-bar">
          <span className="sh-order-hint">Kolejność zmieniona</span>
          <button className="btn btn-ghost btn-sm" onClick={resetOrder}>Anuluj</button>
          <button className="btn btn-primary btn-sm" onClick={saveOrder} disabled={savingOrder}>
            {savingOrder ? 'Zapisuję…' : 'Zapisz kolejność'}
          </button>
        </div>
      )}
      <Reorder.Group
        axis="y"
        values={items}
        onReorder={(newItems) => { setItems(newItems); setOrderDirty(true) }}
        className="spin-history-list"
        style={{ listStyle: 'none', padding: 0, margin: 0 }}
      >
        {items.map((entry, idx) => (
          <Reorder.Item
            key={entry.row_index}
            value={entry}
            className="spin-history-row sh-row"
            dragListener={editingRow !== entry.row_index}
          >
            <span className="sh-drag-handle" title="Przeciągnij aby zmienić kolejność">⠿</span>
            <span className="sh-num">{idx + 1}</span>

            {editingRow === entry.row_index ? (
              <>
                <input
                  className="sh-input"
                  value={editPerson}
                  onChange={e => setEditPerson(e.target.value)}
                  placeholder="Klucz osoby…"
                  autoFocus
                />
                <input
                  className="sh-input sh-input-cat"
                  value={editCat}
                  onChange={e => setEditCat(e.target.value)}
                  placeholder="Kategoria…"
                />
                <button className="btn btn-primary btn-sm sh-save" onClick={() => saveEdit(entry.row_index)} disabled={saving}>
                  {saving ? '…' : '✓'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>✕</button>
              </>
            ) : (
              <>
                <span className="spin-history-person">{entry.person}</span>
                <span className="spin-history-cat">{entry.category}</span>
                <button className="sh-edit-btn" onClick={() => startEdit(entry)} title="Edytuj">✏</button>
                <button className="wheel-cat-delete" onClick={() => deleteEntry(entry.row_index, `${entry.person}: ${entry.category}`)} title="Usuń">✕</button>
              </>
            )}
          </Reorder.Item>
        ))}
      </Reorder.Group>
    </div>
  )
}

export default function AdminPanel() {
  const nav = useNavigate()
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('adminToken'))
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  const [people, setPeople] = useState<AdminPerson[]>([])
  const [loadingPeople, setLoadingPeople] = useState(false)
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState('')
  const [actionMsg, setActionMsg] = useState('')

  const [wheelEntries, setWheelEntries] = useState<WheelEntry[]>([])
  const [wheelHistory, setWheelHistory] = useState<HistoryEntry[]>([])
  const [loadingWheel, setLoadingWheel] = useState(false)
  const [addCatInputs, setAddCatInputs] = useState<Record<string, string>>({})
  const [addCatSaving, setAddCatSaving] = useState<string | null>(null)

  const [nextNightDate, setNextNightDate] = useState<string>('')
  const [nextNightTime, setNextNightTime] = useState<string>('')
  const [savingDate, setSavingDate] = useState(false)

  const [forcedSpin, setForcedSpin] = useState<ForcedSpin | null>(null)
  const [winnerPersonKey, setWinnerPersonKey] = useState('')
  const [winnerCategory, setWinnerCategory] = useState('')
  const [settingWinner, setSettingWinner] = useState(false)

  const [simResults, setSimResults] = useState<{ person: string; category: string }[] | null>(null)
  const [simLoading, setSimLoading] = useState(false)

  const [nights, setNights] = useState<NightSummary[]>([])
  const [deletingNight, setDeletingNight] = useState<string | null>(null)

  const loadPeople = async (tok: string) => {
    setLoadingPeople(true)
    try {
      const list = await adminGetPeople(tok)
      setPeople(list)
    } catch {
      setToken(null)
      sessionStorage.removeItem('adminToken')
    } finally {
      setLoadingPeople(false)
    }
  }

  const loadWheelCategories = () => {
    setLoadingWheel(true)
    getWheelData().then(d => {
      setWheelEntries(d.entries)
      setWheelHistory(d.history)
      setForcedSpin(d.forced_spin)
    }).finally(() => setLoadingWheel(false))
  }

  const loadNights = () => getNights().then(setNights).catch(() => {})

  useEffect(() => {
    if (token) { loadPeople(token); loadWheelCategories(); loadNights() }
    getNextNightDate().then(d => { setNextNightDate(d.date ?? ''); setNextNightTime(d.time ?? '') }).catch(() => {})
  }, [token])

  const handleSetNextCategory = async () => {
    if (!token || !winnerPersonKey || !winnerCategory) return
    setSettingWinner(true)
    try {
      await adminSetNextCategory(winnerPersonKey, winnerCategory, token)
      flash(`✅ Ustawiono zwycięzcę: ${winnerCategory}`)
      setWinnerPersonKey('')
      setWinnerCategory('')
      loadWheelCategories()
    } catch (e: any) {
      flash(`❌ ${e?.response?.data?.detail || 'Błąd ustawiania zwycięzcy'}`)
    } finally {
      setSettingWinner(false)
    }
  }

  const handleClearNextCategory = async () => {
    if (!token) return
    try {
      await adminClearNextCategory(token)
      flash(`🗑 Wyczyszczono następnego zwycięzcę`)
      loadWheelCategories()
    } catch (e: any) {
      flash(`❌ ${e?.response?.data?.detail || 'Błąd czyszczenia'}`)
    }
  }

  const handleSaveDate = async () => {
    if (!token) return
    setSavingDate(true)
    try {
      await adminSetNextNightDate(nextNightDate || null, nextNightTime || null, token)
      flash(`✅ Data następnej nocy zapisana`)
    } catch {
      flash(`❌ Błąd zapisu daty`)
    } finally {
      setSavingDate(false)
    }
  }

  const shiftDate = async (weeks: number) => {
    if (!token) return
    const base = nextNightDate ? new Date(nextNightDate + 'T12:00:00') : new Date()
    base.setDate(base.getDate() + weeks * 7)
    const newDate = base.toISOString().split('T')[0]
    setNextNightDate(newDate)
    setSavingDate(true)
    try {
      await adminSetNextNightDate(newDate, nextNightTime || null, token)
      flash(`✅ Przesunięto o ${weeks > 0 ? '+' : ''}${weeks} tydz. → ${newDate}`)
    } catch {
      flash(`❌ Błąd zapisu daty`)
    } finally {
      setSavingDate(false)
    }
  }

  const handleDeleteNight = async (season: number, name: string) => {
    if (!token) return
    const key = `${season}:${name}`
    setDeletingNight(key)
    try {
      await adminDeleteNight(season, name, token)
      flash(`🗑 Usunięto noc: ${name}`)
      loadNights()
    } catch (e: any) {
      flash(`❌ ${e?.response?.data?.detail || 'Błąd usuwania nocy'}`)
    } finally {
      setDeletingNight(null)
    }
  }

  const handleSimulate = async () => {
    setSimLoading(true)
    try {
      const data = await simulateSpins(20)
      setSimResults(data.picks)
    } catch {
      flash('❌ Błąd symulacji')
    } finally {
      setSimLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginLoading(true)
    setLoginError('')
    try {
      const { token: tok } = await adminLogin(password)
      sessionStorage.setItem('adminToken', tok)
      setToken(tok)
      setPassword('')
    } catch {
      setLoginError('Nieprawidłowe hasło')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = async () => {
    if (token) await adminLogout(token)
    sessionStorage.removeItem('adminToken')
    setToken(null)
    setPeople([])
  }

  const flash = (msg: string) => {
    setActionMsg(msg)
    setTimeout(() => setActionMsg(''), 2500)
  }

  const handleAdd = async () => {
    if (!token || !newName.trim()) return
    setAddError('')
    try {
      await adminAddPerson(newName.trim(), token)
      flash(`✅ Dodano: ${newName.trim()}`)
      setNewName('')
      await loadPeople(token)
    } catch (e: any) {
      setAddError(e?.response?.data?.detail || 'Błąd')
    }
  }

  const handleHide = async (name: string) => {
    if (!token) return
    await adminHidePerson(name, token)
    flash(`🙈 Ukryto: ${name}`)
    await loadPeople(token)
  }

  const handleShow = async (name: string) => {
    if (!token) return
    await adminShowPerson(name, token)
    flash(`👁 Przywrócono: ${name}`)
    await loadPeople(token)
  }

  const handleAddCategory = async (personKey: string) => {
    const val = (addCatInputs[personKey] ?? '').trim()
    if (!val) return
    setAddCatSaving(personKey)
    try {
      await addCategories({ [personKey]: [val] })
      setAddCatInputs(i => ({ ...i, [personKey]: '' }))
      flash(`✅ Dodano: ${val}`)
      loadWheelCategories()
    } catch (e: any) {
      flash(`❌ ${e?.response?.data?.detail || 'Błąd'}`)
    } finally {
      setAddCatSaving(null)
    }
  }

  const handleDeleteCategory = async (personKey: string, category: string) => {
    if (!token) return
    try {
      await adminDeleteCategory(personKey, category, token)
      flash(`🗑 Usunięto: ${category}`)
      loadWheelCategories()
    } catch (e: any) {
      flash(`❌ ${e?.response?.data?.detail || 'Błąd usuwania'}`)
    }
  }

  const active = people.filter(p => !p.hidden)
  const hidden = people.filter(p => p.hidden)

  return (
    <div className="admin-page">
      <div className="page-header">
        <button className="back-btn" onClick={() => nav('/')}>← Wróć</button>
        <span className="page-title">⚙ Panel administracyjny</span>
        {token && (
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Wyloguj</button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {!token ? (
          <motion.div
            key="login"
            className="login-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <div className="login-icon">🔐</div>
            <h2 className="login-title">Dostęp administracyjny</h2>
            <form onSubmit={handleLogin} className="login-form">
              <input
                type="password"
                placeholder="Hasło administratora"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
              />
              {loginError && <div className="error-msg">{loginError}</div>}
              <button type="submit" className="btn btn-primary" disabled={loginLoading || !password}>
                {loginLoading ? 'Sprawdzam…' : 'Zaloguj się'}
              </button>
            </form>
          </motion.div>
        ) : (
          <motion.div key="panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {actionMsg && (
              <motion.div
                className="action-flash"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {actionMsg}
              </motion.div>
            )}

            <div className="admin-section">
              <div className="admin-section-title">📅 Następna noc filmowa</div>
              <div className="add-person-row">
                <input
                  type="date"
                  value={nextNightDate}
                  onChange={e => setNextNightDate(e.target.value)}
                />
                <input
                  type="time"
                  value={nextNightTime}
                  onChange={e => setNextNightTime(e.target.value)}
                  placeholder="Godzina…"
                  style={{ width: 120 }}
                />
                <button className="btn btn-primary" onClick={handleSaveDate} disabled={savingDate}>
                  {savingDate ? '…' : 'Zapisz'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => shiftDate(-1)} disabled={savingDate}>
                  −1 tydz
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => shiftDate(1)} disabled={savingDate}>
                  +1 tydz
                </button>
                {nextNightDate && (
                  <button className="btn btn-ghost btn-sm" onClick={() => { setNextNightDate(''); setNextNightTime(''); adminSetNextNightDate(null, null, token!).catch(() => {}) }}>
                    Wyczyść
                  </button>
                )}
              </div>
            </div>

            <div className="admin-section">
              <div className="admin-section-title">🎯 Następny zwycięzca kategorii</div>
              {forcedSpin ? (
                <div className="next-winner-current">
                  <span className="next-winner-badge">
                    <span className="next-winner-person">
                      {wheelEntries.find(e => e.key === forcedSpin.person_key)?.name ?? forcedSpin.person_key}
                    </span>
                    <span className="next-winner-arrow">→</span>
                    <span className="next-winner-cat">{forcedSpin.category}</span>
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={handleClearNextCategory}>
                    Wyczyść
                  </button>
                </div>
              ) : (
                <div className="next-winner-empty">Brak ustawionego zwycięzcy</div>
              )}
              <div className="add-person-row next-winner-form">
                <select
                  value={winnerPersonKey}
                  onChange={e => { setWinnerPersonKey(e.target.value); setWinnerCategory('') }}
                >
                  <option value="">— Wybierz osobę —</option>
                  {wheelEntries.map(e => (
                    <option key={e.key} value={e.key}>{e.name}</option>
                  ))}
                </select>
                <select
                  value={winnerCategory}
                  onChange={e => setWinnerCategory(e.target.value)}
                  disabled={!winnerPersonKey}
                >
                  <option value="">— Wybierz kategorię —</option>
                  {(wheelEntries.find(e => e.key === winnerPersonKey)?.categories ?? []).map((cat, i) => (
                    <option key={i} value={cat}>{cat}</option>
                  ))}
                </select>
                <button
                  className="btn btn-primary"
                  onClick={handleSetNextCategory}
                  disabled={settingWinner || !winnerPersonKey || !winnerCategory}
                >
                  {settingWinner ? '…' : 'Ustaw zwycięzcę'}
                </button>
              </div>
            </div>

            <div className="admin-section">
              <div className="admin-section-title">➕ Dodaj nową osobę</div>
              <div className="add-person-row">
                <input
                  type="text"
                  placeholder="Imię nowej osoby…"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                />
                <button className="btn btn-primary" onClick={handleAdd} disabled={!newName.trim()}>
                  Dodaj
                </button>
              </div>
              {addError && <div className="error-msg">{addError}</div>}
            </div>

            <div className="admin-section">
              <div className="admin-section-title">👥 Aktywni uczestnicy ({active.length})</div>
              {loadingPeople ? (
                <div className="loading"><div className="spinner" /></div>
              ) : (
                <div className="people-list">
                  {active.map(p => (
                    <div key={p.name} className="person-row">
                      <span className="person-name">{p.name}</span>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleHide(p.name)}
                      >
                        Ukryj
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {hidden.length > 0 && (
              <div className="admin-section">
                <div className="admin-section-title">🙈 Ukryci ({hidden.length})</div>
                <div className="people-list people-list-hidden">
                  {hidden.map(p => (
                    <div key={p.name} className="person-row">
                      <span className="person-name person-name-hidden">{p.name}</span>
                      <button
                        className="btn btn-success btn-sm"
                        onClick={() => handleShow(p.name)}
                      >
                        Przywróć
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="admin-section">
              <div className="admin-section-title">🎡 Kategorie koła</div>
              {loadingWheel ? (
                <div className="loading"><div className="spinner" /></div>
              ) : (
                <div className="wheel-cats-list">
                  {wheelEntries.map(entry => (
                    <div key={entry.key} className="wheel-cat-person">
                      <div className="wheel-cat-person-name">{entry.name}</div>
                      <div className="wheel-cat-chips">
                        {entry.categories.map((cat, i) => (
                          <div key={i} className="wheel-cat-chip">
                            <span>{cat}</span>
                            <button
                              className="wheel-cat-delete"
                              onClick={() => handleDeleteCategory(entry.key, cat)}
                              title="Usuń"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="wc-add-row">
                        <input
                          placeholder="Dodaj kategorię…"
                          value={addCatInputs[entry.key] ?? ''}
                          onChange={e => setAddCatInputs(i => ({ ...i, [entry.key]: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && handleAddCategory(entry.key)}
                        />
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={addCatSaving === entry.key || !(addCatInputs[entry.key] ?? '').trim()}
                          onClick={() => handleAddCategory(entry.key)}
                        >
                          {addCatSaving === entry.key ? '…' : '+'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="admin-section">
              <div className="admin-section-title">🧪 Symulacja losowań</div>
              <button
                className="btn btn-primary"
                onClick={handleSimulate}
                disabled={simLoading}
              >
                {simLoading ? 'Symuluję…' : 'Symuluj 20 losowań'}
              </button>
            </div>

            {simResults && (
              <div className="sim-modal-backdrop" onClick={() => setSimResults(null)}>
                <div className="sim-modal" onClick={e => e.stopPropagation()}>
                  <div className="sim-modal-header">
                    <span>🧪 Wyniki symulacji</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSimResults(null)}>✕</button>
                  </div>
                  <ol className="sim-list">
                    {simResults.map((pick, i) => (
                      <li key={i} className="sim-row">
                        <span className="sim-num">{i + 1}</span>
                        <span className="sim-person">{pick.person}</span>
                        <span className="sim-cat">{pick.category}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}

            <div className="admin-section">
              <div className="admin-section-title">🎬 Historia nocy ({nights.length})</div>
              <div className="nights-delete-list">
                {[4, 3, 2, 1].map(season => {
                  const seasonNights = nights.filter(n => n.season === season)
                  if (!seasonNights.length) return null
                  return (
                    <div key={season} className="nights-season-group">
                      <div className="nights-season-label">Sezon {season}</div>
                      {[...seasonNights].reverse().map(night => {
                        const key = `${season}:${night.name}`
                        return (
                          <div key={night.name} className="night-delete-row">
                            <span className="night-delete-name">{night.name}</span>
                            <span className="night-delete-count">{night.movies.length} film{night.movies.length === 1 ? '' : night.movies.length < 5 ? 'y' : 'ów'}</span>
                            <button
                              className="wheel-cat-delete"
                              disabled={deletingNight === key}
                              onClick={() => handleDeleteNight(season, night.name)}
                              title="Usuń noc"
                            >
                              {deletingNight === key ? '…' : '✕'}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="admin-section">
              <div className="admin-section-title">🎰 Historia losowań ({wheelHistory.length})</div>
              {loadingWheel ? (
                <div className="loading"><div className="spinner" /></div>
              ) : wheelHistory.length === 0 ? (
                <div className="history-empty">Brak historii</div>
              ) : token && (
                <SpinHistoryEditor
                  history={wheelHistory}
                  token={token}
                  onChanged={loadWheelCategories}
                  onFlash={flash}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
