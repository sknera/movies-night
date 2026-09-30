import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { getStats, getAwards } from '../../api'
import type { PersonStat, Awards, AwardEntry } from '../../api'
import PersonDrawer from '../../components/PersonDrawer'
import './StatsPage.css'

type SortKey = 'watched' | 'average' | 'name'

// ── AwardsSection ──────────────────────────────────────────────────────────

function AwardsSection({ awards }: { awards: Awards }) {
  const items: { key: keyof Awards; icon: string; label: string; stat: (e: AwardEntry) => string }[] = [
    { key: 'harshest',     icon: '🗡️', label: 'Najsurowszy krytyk',     stat: e => `śr. ${e.avg.toFixed(2)}` },
    { key: 'generous',     icon: '🎊', label: 'Największy entuzjasta',   stat: e => `śr. ${e.avg.toFixed(2)}` },
    { key: 'controversial',icon: '🔥', label: 'Kontrowersyjny głosujący',stat: e => `σ ${e.std_dev.toFixed(2)}` },
    { key: 'aligned',      icon: '🤝', label: 'Zgodny z grupą',          stat: e => `Δ ${e.mae.toFixed(2)}` },
  ]
  const visible = items.filter(i => awards[i.key] && i.key !== 'min_movies')
  if (visible.length === 0) return null
  return (
    <div className="awards-section">
      <div className="awards-title">Wyróżnienia</div>
      <div className="awards-grid">
        {visible.map(({ key, icon, label, stat }) => {
          const entry = awards[key] as AwardEntry
          return (
            <div key={key} className="award-card">
              <div className="award-icon">{icon}</div>
              <div className="award-body">
                <div className="award-label">{label}</div>
                <div className="award-name">{entry.name}</div>
                <div className="award-stat">{stat(entry)} · {entry.watched} filmów</div>
              </div>
            </div>
          )
        })}
      </div>
      {(awards.min_movies || awards.last_n) && (
        <div className="awards-footnote">
          {awards.last_n && `ostatnie ${awards.last_n} filmów`}
          {awards.last_n && awards.min_movies && ' · '}
          {awards.min_movies && `min. ${awards.min_movies} filmów do kwalifikacji`}
        </div>
      )}
    </div>
  )
}

export default function StatsPage() {
  const nav = useNavigate()
  const [stats, setStats] = useState<PersonStat[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortKey>('watched')
  const [selectedPerson, setSelectedPerson] = useState<PersonStat | null>(null)
  const [awards, setAwards] = useState<Awards>({})

  const loadStats = () => {
    getStats().then(s => { setStats(s); setLoading(false) }).catch(() => setLoading(false))
  }

  useEffect(() => {
    loadStats()
    getAwards().then(setAwards).catch(() => {})
  }, [])

  const handleColorChanged = (name: string, color: string) => {
    setStats(prev => prev.map(p => p.name === name ? { ...p, color } : p))
    setSelectedPerson(prev => prev?.name === name ? { ...prev, color } : prev)
  }

  const ratedStats = stats.filter(s => s.average !== null && s.watched > 0)
  const globalMean = ratedStats.length
    ? ratedStats.reduce((s, p) => s + p.average!, 0) / ratedStats.length
    : 5.5
  const priorWeight = ratedStats.length
    ? ratedStats.reduce((s, p) => s + p.watched, 0) / ratedStats.length
    : 10
  const bayesianAvg = (p: PersonStat) =>
    p.average === null ? 0
      : (p.watched * p.average + priorWeight * globalMean) / (p.watched + priorWeight)

  const sorted = [...stats].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    if (sort === 'average') return bayesianAvg(b) - bayesianAvg(a)
    return b.watched - a.watched
  })

  const maxWatched = Math.max(...stats.map(s => s.watched), 1)
  const maxAvg = 10

  if (loading) return <div className="loading"><div className="spinner" /><span>Ładowanie…</span></div>

  return (
    <div className="stats-page">
      <div className="page-header">
        <button className="back-btn" onClick={() => nav('/')}>← Wróć</button>
        <span className="page-title">Statystyki 📊</span>
      </div>

      <AwardsSection awards={awards} />

      <div className="stats-sort-bar">
        <span className="sort-label">Sortuj:</span>
        {(['watched', 'average', 'name'] as SortKey[]).map(key => (
          <button
            key={key}
            className={`sort-btn ${sort === key ? 'sort-btn-active' : ''}`}
            onClick={() => setSort(key)}
          >
            {key === 'watched' ? 'Obejrzane' : key === 'average' ? 'Średnia' : 'Imię'}
          </button>
        ))}
      </div>

      <div className="stats-grid">
        {sorted.map((p, i) => (
          <motion.div
            key={p.name}
            className="stat-card"
            style={{ '--person-color': p.color } as React.CSSProperties}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            onClick={() => setSelectedPerson(p)}
          >
            <div className="stat-card-header">
              <div className="stat-avatar" style={{ borderColor: p.color, color: p.color }}>{p.name.slice(0, 2)}</div>
              <div className="stat-name">{p.name}</div>
            </div>

            <div className="stat-bars">
              <div className="stat-row">
                <div className="stat-row-label">Filmy</div>
                <div className="stat-bar-wrap">
                  <div className="stat-bar" style={{ width: `${(p.watched / maxWatched) * 100}%`, background: p.color }} />
                </div>
                <div className="stat-row-val">{p.watched}</div>
              </div>

              <div className="stat-row">
                <div className="stat-row-label">Śr. ocena</div>
                <div className="stat-bar-wrap">
                  <div className="stat-bar" style={{ width: `${((p.average ?? 0) / maxAvg) * 100}%`, background: p.color, opacity: 0.75 }} />
                </div>
                <div className="stat-row-val">{p.average !== null ? p.average.toFixed(2) : '—'}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {selectedPerson && (
          <PersonDrawer
            person={selectedPerson}
            onClose={() => setSelectedPerson(null)}
            onRenamed={() => { setSelectedPerson(null); loadStats() }}
            onColorChanged={handleColorChanged}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
