import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { adminEditScore, adminDeleteNight, adminDeleteMovieRow, getSeasonPeople } from '../api'
import type { NightMovie } from '../api'
import './EditNightModal.css'

interface Props {
  nightName: string
  season: number
  movies: NightMovie[]
  adminToken: string
  onClose: () => void
  onSaved: () => void
}

type Edits = Record<string, Record<string, string>> // rowNum|movieTitle → person → raw input

export default function EditNightModal({ nightName, season, movies, adminToken, onClose, onSaved }: Props) {
  const [edits, setEdits] = useState<Edits>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<string | null>(null)
  const [deletingRow, setDeletingRow] = useState(false)
  const [error, setError] = useState('')
  const [allPeople, setAllPeople] = useState<string[]>([])
  const [extraPeople, setExtraPeople] = useState<string[]>([])

  // People visible in this night's scores
  const nightPeople = Array.from(
    new Set(movies.flatMap(m => Object.keys(m.scores ?? {})))
  ).sort()

  // All people present in the table = nightPeople + extraPeople
  const tablePeople = Array.from(new Set([...nightPeople, ...extraPeople])).sort()

  useEffect(() => {
    getSeasonPeople(season).then(p => setAllPeople(p)).catch(() => {})
  }, [season])

  const availableToAdd = allPeople.filter(p => !tablePeople.includes(p))

  const movieKey = (m: NightMovie) => `${m.row_num ?? m.title}`

  const getCellValue = (m: NightMovie, person: string): string => {
    const key = movieKey(m)
    if (edits[key]?.[person] !== undefined) return edits[key][person]
    const existing = m.scores?.[person]
    return existing !== undefined ? String(existing) : ''
  }

  const setCell = (m: NightMovie, person: string, val: string) => {
    const key = movieKey(m)
    setEdits(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), [person]: val },
    }))
  }

  const handleDeleteRow = async (m: NightMovie) => {
    if (!m.row_num) return
    setDeletingRow(true)
    setError('')
    try {
      await adminDeleteMovieRow(season, m.row_num, adminToken)
      onSaved()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Błąd usuwania wiersza')
      setConfirmDeleteRow(null)
    } finally {
      setDeletingRow(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    setError('')
    try {
      await adminDeleteNight(season, nightName, adminToken)
      onSaved()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Błąd usuwania')
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    const ops: Array<{ movie: NightMovie; person: string; score: number | null }> = []

    for (const m of movies) {
      if (!m.row_num) continue
      const key = movieKey(m)
      const movieEdits = edits[key] ?? {}

      for (const person of tablePeople) {
        const raw = getCellValue(m, person)
        const orig = m.scores?.[person]
        const origStr = orig !== undefined ? String(orig) : ''

        if (raw === origStr) continue // unchanged

        const score = raw.trim() === '' ? null : parseFloat(raw.replace(',', '.'))
        if (raw.trim() !== '' && (isNaN(score!) || score! < 0 || score! > 10)) {
          setError(`Nieprawidłowa ocena: "${raw}" dla ${person}`)
          setSaving(false)
          return
        }

        ops.push({ movie: m, person, score: raw.trim() === '' ? null : score })
      }

      // Also check extra people
      for (const person of extraPeople) {
        const raw = (movieEdits[person] ?? '').trim()
        if (!raw) continue
        const score = parseFloat(raw.replace(',', '.'))
        if (isNaN(score) || score < 0 || score > 10) {
          setError(`Nieprawidłowa ocena: "${raw}" dla ${person}`)
          setSaving(false)
          return
        }
        if (m.scores?.[person] === undefined) {
          ops.push({ movie: m, person, score })
        }
      }
    }

    if (ops.length === 0) { onClose(); return }

    try {
      for (const { movie, person, score } of ops) {
        await adminEditScore(season, movie.row_num!, person, score, adminToken)
      }
      onSaved()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Błąd zapisu')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      className="enm-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="enm-modal"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="enm-header">
          <div className="enm-title">Edytuj: {nightName}</div>
          <button className="enm-close" onClick={onClose}>✕</button>
        </div>

        <div className="enm-table-wrap">
          <table className="enm-table">
            <thead>
              <tr>
                <th className="enm-th enm-th-movie">Film</th>
                {tablePeople.map(p => (
                  <th key={p} className="enm-th">{p}</th>
                ))}
                <th className="enm-th enm-th-del" />
              </tr>
            </thead>
            <tbody>
              {movies.map(m => {
                const key = movieKey(m)
                const isConfirming = confirmDeleteRow === key
                return (
                  <tr key={key}>
                    <td className="enm-td-movie">{m.title}</td>
                    {tablePeople.map(person => (
                      <td key={person} className="enm-td">
                        <input
                          className="enm-input"
                          type="text"
                          inputMode="decimal"
                          value={getCellValue(m, person)}
                          onChange={e => setCell(m, person, e.target.value)}
                          placeholder="—"
                        />
                      </td>
                    ))}
                    <td className="enm-td enm-td-del">
                      {isConfirming ? (
                        <div className="enm-row-confirm">
                          <button
                            className="enm-row-del-yes"
                            disabled={deletingRow}
                            onClick={() => handleDeleteRow(m)}
                          >
                            {deletingRow ? '…' : 'Tak'}
                          </button>
                          <button
                            className="enm-row-del-no"
                            onClick={() => setConfirmDeleteRow(null)}
                          >
                            Nie
                          </button>
                        </div>
                      ) : (
                        <button
                          className="enm-row-del-btn"
                          title="Usuń film"
                          onClick={() => setConfirmDeleteRow(key)}
                        >
                          🗑
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {availableToAdd.length > 0 && (
          <div className="enm-add-person">
            <span className="enm-add-label">Dodaj osobę:</span>
            <select
              className="enm-select"
              value=""
              onChange={e => { if (e.target.value) setExtraPeople(prev => [...prev, e.target.value]) }}
            >
              <option value="">— wybierz —</option>
              {availableToAdd.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}

        {error && <div className="error-msg">{error}</div>}

        <div className="enm-footer">
          {confirmDelete ? (
            <>
              <span className="enm-delete-confirm-label">Na pewno usunąć całą noc?</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>Nie</button>
              <button className="btn btn-danger btn-sm" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Usuwam…' : 'Tak, usuń'}
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm enm-delete-btn" onClick={() => setConfirmDelete(true)}>
                🗑 Usuń noc
              </button>
              <div className="enm-footer-right">
                <button className="btn btn-ghost btn-sm" onClick={onClose}>Anuluj</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Zapisuję…' : 'Zapisz zmiany'}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
