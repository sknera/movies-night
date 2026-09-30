import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { getNights, getStats } from '../../api'
import type { NightSummary, NightMovie, PersonStat } from '../../api'
import { avgColor } from '../../utils/color'
import { SEASONS } from '../../constants/seasons'
import { splitCategoryName } from '../../utils/emoji'
import MovieDetailModal from '../../components/MovieDetailModal'
import EditNightModal from '../../components/EditNightModal'
import PersonDrawer from '../../components/PersonDrawer'
import './HistoryPage.css'

// ── Badge computation ──────────────────────────────────────────────────────

interface MovieStats { title: string; season: number; category: string | null; avg: number; stdDev: number; count: number }

function computeBadges(nights: NightSummary[]) {
  const stats: Record<string, MovieStats> = {}

  for (const night of nights) {
    for (const m of night.movies) {
      if (!m.scores || Object.keys(m.scores).length < 3) continue
      const key = `${m.title}|||${night.season}`
      const vals = Object.values(m.scores)
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length
      const variance = vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length
      stats[key] = {
        title: m.title,
        season: night.season,
        category: night.name,
        avg,
        stdDev: Math.sqrt(variance),
        count: vals.length,
      }
    }
  }

  const all = Object.values(stats)
  const byAvgDesc = [...all].sort((a, b) => b.avg - a.avg)
  const byStd = [...all].sort((a, b) => b.stdDev - a.stdDev)

  const bestSet = new Set(byAvgDesc.slice(0, 10).map(m => `${m.title}|||${m.season}`))
  const worstSet = new Set(byAvgDesc.slice(-10).map(m => `${m.title}|||${m.season}`))
  const controversySet = new Set(byStd.slice(0, 10).map(m => `${m.title}|||${m.season}`))

  return { bestSet, worstSet, controversySet }
}

// ── Night Detail ───────────────────────────────────────────────────────────

function NightDetail({
  movies,
  host,
  season,
  bestSet,
  worstSet,
  controversySet,
  onMovieClick,
  onPersonClick,
}: {
  movies: NightMovie[]
  host?: string
  season: number
  bestSet: Set<string>
  worstSet: Set<string>
  controversySet: Set<string>
  onMovieClick: (m: NightMovie) => void
  onPersonClick: (name: string) => void
}) {
  const allPeople = Array.from(
    new Set(movies.flatMap(m => Object.keys(m.scores ?? {})))
  ).sort()

  return (
    <div className="night-detail">
      {host && (
        <div className="nd-host">
          zaproponowane przez{' '}
          <strong
            className="nd-person-link"
            onClick={e => { e.stopPropagation(); onPersonClick(host) }}
          >
            {host}
          </strong>
        </div>
      )}
      {movies.map((m, mi) => {
        const scores = m.scores ?? {}
        const color = m.average !== null ? avgColor(m.average) : undefined
        const key = `${m.title}|||${season}`
        return (
          <div key={mi} className="nd-movie">
            <div className="nd-movie-header">
              <span
                className="nd-movie-title nd-movie-clickable"
                onClick={() => onMovieClick(m)}
                title="Kliknij, aby zobaczyć szczegóły"
              >
                {m.title}
                {bestSet.has(key) && <span className="nd-badge nd-badge-best" title="Top 10 najlepszych">🏆</span>}
                {worstSet.has(key) && <span className="nd-badge nd-badge-worst" title="Top 10 najgorszych">💀</span>}
                {controversySet.has(key) && <span className="nd-badge nd-badge-controversy" title="Top 10 najbardziej kontrowersyjnych">🔥</span>}
              </span>
              <span className="nd-movie-avg" style={color ? { color } : {}}>
                śr. {m.average !== null ? m.average.toFixed(1) : '—'}
              </span>
            </div>
            {allPeople.length > 0 && (
              <div className="nd-scores">
                {allPeople.map(person => {
                  const score = scores[person]
                  return (
                    <span
                      key={person}
                      className={`nd-score-chip nd-score-chip-clickable ${score == null ? 'nd-score-missing' : ''}`}
                      onClick={e => { e.stopPropagation(); onPersonClick(person) }}
                    >
                      <span className="nd-score-person">{person}</span>
                      <span className="nd-score-val">
                        {score != null ? (score % 1 === 0 ? score.toFixed(0) : score.toFixed(1)) : '—'}
                      </span>
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const nav = useNavigate()
  const [nights, setNights] = useState<NightSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedMovie, setSelectedMovie] = useState<{ movie: NightMovie; night: NightSummary } | null>(null)
  const [editingNight, setEditingNight] = useState<NightSummary | null>(null)
  const [selectedPerson, setSelectedPerson] = useState<PersonStat | null>(null)
  const statsCache = useRef<PersonStat[] | null>(null)

  const adminToken = sessionStorage.getItem('adminToken')

  const handlePersonClick = async (name: string) => {
    try {
      let stats = statsCache.current
      if (!stats) {
        stats = await getStats()
        statsCache.current = stats
      }
      const found = stats.find(s => s.name === name)
      setSelectedPerson(found ?? { name, watched: 0, average: null, color: '#674EA7' })
    } catch {
      setSelectedPerson({ name, watched: 0, average: null, color: '#674EA7' })
    }
  }

  const loadNights = () => {
    setLoading(true)
    getNights()
      .then(data => setNights(data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadNights() }, [])

  const { bestSet, worstSet, controversySet } = useMemo(() => computeBadges(nights), [nights])

  const toggleNight = (key: string) => setExpandedKey(k => k === key ? null : key)

  const query = search.trim().toLowerCase()
  const matchesNight = (night: NightSummary) => {
    if (!query) return true
    if (night.name.toLowerCase().includes(query)) return true
    if (night.host?.toLowerCase().includes(query)) return true
    return night.movies.some(m => m.title.toLowerCase().includes(query))
  }

  return (
    <div className="history-page">
      <div className="page-header">
        <button className="back-btn" onClick={() => nav('/')}>← Wróć</button>
        <h1 className="page-title">Historia nocy 🎬</h1>
      </div>

      <div className="history-search-wrap">
        <input
          className="history-search"
          type="text"
          placeholder="Szukaj nocy, hosta lub filmu…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button className="history-search-clear" onClick={() => setSearch('')}>✕</button>
        )}
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /><span>Ładowanie…</span></div>
      ) : (
        <div className="history-seasons">
          {Object.keys(SEASONS).map(Number).map(season => {
            const seasonNights = nights.filter(n => n.season === season && matchesNight(n))
            const { color, name } = SEASONS[season]
            return (
              <div key={season} className="history-season-col">
                <div className="season-col-header" style={{ borderBottomColor: color }}>
                  <span className="season-col-title" style={{ color }}>{name}</span>
                  <span className="season-col-meta">
                    {seasonNights.length} nocy · {seasonNights.reduce((s, n) => s + n.movie_count, 0)} filmów
                  </span>
                </div>
                <div className="season-nights">
                  {seasonNights.map((night, idx) => {
                    const key = `${season}-${night.name}-${idx}`
                    const isExpanded = expandedKey === key
                    const peopleCount = new Set(night.movies.flatMap(m => Object.keys(m.scores ?? {}))).size
                    return (
                      <div key={key} className="night-entry">
                        <div
                          className={`night-card ${isExpanded ? 'night-card-active' : ''}`}
                          style={isExpanded ? { borderColor: color } : {}}
                          onClick={() => toggleNight(key)}
                        >
                          <div className="night-card-top">
                            <div className="night-name">
                              {splitCategoryName(night.name).text}
                              {splitCategoryName(night.name).badge && (
                                <span className="night-name-emoji">{splitCategoryName(night.name).badge}</span>
                              )}
                            </div>
                            <div className="night-count">
                              {night.movie_count} {night.movie_count === 1 ? 'film' : night.movie_count < 5 ? 'filmy' : 'filmów'}
                            </div>
                            {peopleCount > 0 && (
                              <div className="night-people-count">
                                {peopleCount} {peopleCount === 1 ? 'osoba' : peopleCount < 5 ? 'osoby' : 'osób'}
                              </div>
                            )}
                            {adminToken && (
                              <button
                                className="night-edit-btn"
                                title="Edytuj oceny"
                                onClick={e => { e.stopPropagation(); setEditingNight(night) }}
                              >
                                ✏
                              </button>
                            )}
                            <span className="night-expand-icon">{isExpanded ? '▲' : '▼'}</span>
                          </div>
                          {night.host && (
                            <div className="night-host">{night.host}</div>
                          )}
                          {night.movies.some(m => m.average !== null) && (
                            <div className="night-avg-indicators">
                              {night.movies.slice(0, 6).map((m, mi) => {
                                const badgeKey = `${m.title}|||${season}`
                                return m.average !== null ? (
                                  <span
                                    key={mi}
                                    className={`night-avg-badge ${bestSet.has(badgeKey) ? 'badge-best' : ''} ${worstSet.has(badgeKey) ? 'badge-worst' : ''} ${controversySet.has(badgeKey) ? 'badge-controversy' : ''}`}
                                    style={{ background: avgColor(m.average) }}
                                    title={`${m.title}${bestSet.has(badgeKey) ? ' 🏆' : ''}${worstSet.has(badgeKey) ? ' 💀' : ''}${controversySet.has(badgeKey) ? ' 🔥' : ''}`}
                                  >
                                    {m.average.toFixed(1)}
                                    {bestSet.has(badgeKey) && <span className="badge-icon">🏆</span>}
                                    {worstSet.has(badgeKey) && <span className="badge-icon">💀</span>}
                                    {controversySet.has(badgeKey) && <span className="badge-icon">🔥</span>}
                                  </span>
                                ) : null
                              })}
                            </div>
                          )}
                        </div>
                        {isExpanded && (
                          <NightDetail
                            movies={night.movies}
                            host={night.host}
                            season={season}
                            bestSet={bestSet}
                            worstSet={worstSet}
                            controversySet={controversySet}
                            onMovieClick={m => setSelectedMovie({ movie: m, night })}
                            onPersonClick={handlePersonClick}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <AnimatePresence>
        {selectedMovie && (
          <MovieDetailModal
            title={selectedMovie.movie.title}
            season={selectedMovie.night.season}
            category={selectedMovie.night.name}
            host={selectedMovie.night.host}
            average={selectedMovie.movie.average}
            scores={selectedMovie.movie.scores ?? {}}
            onClose={() => setSelectedMovie(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingNight && adminToken && (
          <EditNightModal
            nightName={editingNight.name}
            season={editingNight.season}
            movies={editingNight.movies}
            adminToken={adminToken}
            onClose={() => setEditingNight(null)}
            onSaved={() => { setEditingNight(null); loadNights() }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedPerson && (
          <PersonDrawer
            person={selectedPerson}
            onClose={() => setSelectedPerson(null)}
            onRenamed={() => { setSelectedPerson(null); statsCache.current = null; loadNights() }}
            onColorChanged={(name, color) => {
              statsCache.current = statsCache.current?.map(p => p.name === name ? { ...p, color } : p) ?? null
              setSelectedPerson(prev => prev?.name === name ? { ...prev, color } : prev)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
