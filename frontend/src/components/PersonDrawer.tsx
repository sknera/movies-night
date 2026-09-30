import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getPersonData, adminRenamePerson, setPersonColor } from '../api'
import type { PersonStat, PersonMovie } from '../api'
import { SEASONS } from '../constants/seasons'
import { splitCategoryName, PERSON_PALETTE } from '../utils/emoji'
import MovieDetailModal from './MovieDetailModal'
import './PersonDrawer.css'

function formatNightsAgo(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n === 0) return 'ostatnia'
  if (n === 1) return '1 noc temu'
  if (n < 5) return `${n} noce temu`
  return `${n} nocy temu`
}

export default function PersonDrawer({
  person,
  onClose,
  onRenamed,
  onColorChanged,
}: {
  person: PersonStat
  onClose: () => void
  onRenamed: () => void
  onColorChanged: (name: string, color: string) => void
}) {
  const [movies, setMovies] = useState<PersonMovie[]>([])
  const [loadingMovies, setLoadingMovies] = useState(true)
  const [selectedMovie, setSelectedMovie] = useState<PersonMovie | null>(null)
  const [renameVal, setRenameVal] = useState(person.name)
  const [renaming, setRenaming] = useState(false)
  const [renameMsg, setRenameMsg] = useState('')
  const [renameError, setRenameError] = useState('')
  const [colorVal, setColorVal] = useState(person.color)
  const [showPalette, setShowPalette] = useState(false)
  const colorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const adminToken = sessionStorage.getItem('adminToken')

  useEffect(() => {
    setLoadingMovies(true)
    getPersonData(person.name)
      .then(d => {
        setMovies(d.movies)
        if (d.color && d.color !== colorVal) {
          setColorVal(d.color)
          onColorChanged(person.name, d.color)
        }
      })
      .finally(() => setLoadingMovies(false))
  }, [person.name])

  const handleColorChange = (c: string) => {
    setColorVal(c)
    onColorChanged(person.name, c)
    if (colorTimer.current) clearTimeout(colorTimer.current)
    colorTimer.current = setTimeout(() => {
      setPersonColor(person.name, c).catch(() => {})
    }, 600)
  }

  const handleRename = async () => {
    if (!adminToken || !renameVal.trim() || renameVal.trim() === person.name) return
    setRenaming(true)
    setRenameError('')
    setRenameMsg('')
    try {
      await adminRenamePerson(person.name, renameVal.trim(), adminToken)
      setRenameMsg(`✅ Zmieniono na: ${renameVal.trim()}`)
      setTimeout(() => { onRenamed(); onClose() }, 1200)
    } catch (e: any) {
      setRenameError(e?.response?.data?.detail || 'Błąd')
    } finally {
      setRenaming(false)
    }
  }

  const groupOrder: Record<string, number> = {}
  const bySeasonCat = movies.reduce<Record<string, PersonMovie[]>>((acc, m, i) => {
    const key = `${m.season}|${m.category ?? '—'}`
    if (!acc[key]) { acc[key] = []; groupOrder[key] = i }
    acc[key].push(m)
    return acc
  }, {})

  return (
    <motion.div
      className="person-drawer-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="person-drawer"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 280, damping: 30 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="drawer-header">
          <div
            className="drawer-avatar drawer-avatar-pick"
            style={{ background: colorVal }}
            onClick={() => setShowPalette(p => !p)}
            title="Zmień kolor"
          >
            {person.name.slice(0, 2)}
            <span className="avatar-pick-hint">◉</span>
          </div>
          <div className="drawer-name">{person.name}</div>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>
        {showPalette && (
          <div className="color-palette-panel">
            {PERSON_PALETTE.map(c => (
              <button
                key={c}
                className={`palette-swatch ${colorVal === c ? 'swatch-active' : ''}`}
                style={{ background: c }}
                onClick={() => { handleColorChange(c); setShowPalette(false) }}
                title={c}
              />
            ))}
          </div>
        )}

        <div className="drawer-stats-row">
          <div className="drawer-stat">
            <div className="drawer-stat-val">{loadingMovies ? '…' : movies.length}</div>
            <div className="drawer-stat-label">filmów</div>
          </div>
          <div className="drawer-stat">
            <div className="drawer-stat-val">
              {loadingMovies ? '…' : movies.length > 0
                ? (movies.reduce((s, m) => s + m.score, 0) / movies.length).toFixed(2)
                : '—'}
            </div>
            <div className="drawer-stat-label">średnia</div>
          </div>
          <div className="drawer-stat">
            <div className="drawer-stat-val">{formatNightsAgo(person.nights_ago)}</div>
            <div className="drawer-stat-label">ostatnia noc</div>
          </div>
        </div>

        {adminToken && (
          <div className="drawer-section">
            <div className="drawer-section-title">Zmień imię</div>
            <div className="rename-row">
              <input
                type="text"
                value={renameVal}
                onChange={e => setRenameVal(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleRename()}
              />
              <button
                className="btn btn-primary btn-sm"
                disabled={renaming || !renameVal.trim() || renameVal.trim() === person.name}
                onClick={handleRename}
              >
                {renaming ? '…' : 'Zapisz'}
              </button>
            </div>
            {renameMsg && <div className="rename-ok">{renameMsg}</div>}
            {renameError && <div className="error-msg">{renameError}</div>}
          </div>
        )}

        <div className="drawer-section drawer-movies-section">
          <div className="drawer-section-title">Ocenione filmy ({movies.length})</div>
          {loadingMovies ? (
            <div className="loading"><div className="spinner" /></div>
          ) : (
            <div className="drawer-movies">
              {Object.entries(bySeasonCat)
                .sort(([a], [b]) => groupOrder[a] - groupOrder[b])
                .map(([key, groupMovies]) => {
                  const [seasonStr, cat] = key.split('|')
                  const season = parseInt(seasonStr)
                  return (
                    <div key={key} className="drawer-movie-group">
                      <div className="drawer-group-header">
                        <span
                          className="drawer-season-badge"
                          style={{ background: SEASONS[season]?.color ?? '#674EA7' }}
                        >
                          S{season}
                        </span>
                        <span className="drawer-group-cat">{splitCategoryName(cat).text}</span>
                        {splitCategoryName(cat).badge && (
                          <span className="cat-emoji-badge">{splitCategoryName(cat).badge}</span>
                        )}
                      </div>
                      {groupMovies.map((m, i) => (
                        <div
                          key={i}
                          className="drawer-movie-row drawer-movie-row-clickable"
                          onClick={() => setSelectedMovie(m)}
                          title="Kliknij, aby zobaczyć szczegóły"
                        >
                          <span className="drawer-movie-title">{m.title}</span>
                          <span className="drawer-movie-score">
                            {m.score % 1 === 0 ? m.score.toFixed(0) : m.score.toFixed(1)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {selectedMovie && (
          <MovieDetailModal
            title={selectedMovie.title}
            season={selectedMovie.season}
            category={selectedMovie.category}
            average={selectedMovie.average}
            scores={selectedMovie.all_scores ?? { [person.name]: selectedMovie.score }}
            onClose={() => setSelectedMovie(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
