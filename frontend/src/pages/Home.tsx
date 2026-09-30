import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { getNextCategory, getNextNightDate } from '../api'
import type { NextCategory } from '../api'
import './Home.css'

const NAV = [
  { label: 'Ocenianie',  sub: 'oceń filmy wieczoru',   path: '/scoring'    },
  { label: 'Koło',       sub: 'następna kategoria',     path: '/wheel'      },
  { label: 'Historia',   sub: 'minione noce filmowe',   path: '/history'    },
  { label: 'Statystyki', sub: 'oceny i rankingi',       path: '/stats'      },
  { label: 'Archiwum',   sub: 'historia seansów',        path: '/attendance' },
]

function fmtDate(d: Date) {
  return d.toLocaleDateString('pl', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function Home() {
  const nav = useNavigate()
  const [nextCat, setNextCat] = useState<NextCategory | null>(null)
  const [nextNightDate, setNextNightDate] = useState<string | null>(null)
  const [nextNightTime, setNextNightTime] = useState<string | null>(null)

  useEffect(() => {
    getNextCategory().then(setNextCat).catch(() => {})
    getNextNightDate().then(d => { setNextNightDate(d.date); setNextNightTime(d.time) }).catch(() => {})
  }, [])

  const todayStr = fmtDate(new Date())
  const nextDateStr = nextNightDate
    ? fmtDate(new Date(nextNightDate + 'T12:00:00'))
    : null

  return (
    <div className="home">
      <div className="home-content">

        {/* ── Klaps ─────────────────────────────────── */}
        <div className="klaps" style={{ perspective: '800px' }}>

          {/* Striped clapper — snaps down on load */}
          <motion.div
            className="klaps-clapper"
            initial={{ rotateX: -55 }}
            animate={{ rotateX: 0 }}
            transition={{ delay: 0.15, type: 'spring', stiffness: 320, damping: 18 }}
            style={{ transformOrigin: 'top center' }}
          >
            <div className="klaps-stripes" />
            <div className="klaps-clapper-info">
              <span>MOVIE NIGHT</span>
              <span>nocki.xerobox.pl</span>
            </div>
          </motion.div>

          {/* Body — slate */}
          <div className="klaps-body">
            <div className="klaps-meta-row">
              <div className="klaps-meta-cell">
                <div className="klaps-meta-label">DZIŚ</div>
                <div className="klaps-meta-val">{todayStr}</div>
              </div>
              {nextDateStr && (
                <div className="klaps-meta-cell">
                  <div className="klaps-meta-label">NASTĘPNA NOC</div>
                  <div className="klaps-meta-val klaps-meta-val-highlight">
                    {nextDateStr}
                    {nextNightTime && <span style={{ opacity: 0.7, marginLeft: 6, fontSize: '0.85em' }}>godz. {nextNightTime}</span>}
                  </div>
                </div>
              )}
            </div>

            <div className="klaps-divider" />

            <div className="klaps-nav-rows">
              {NAV.map((item, i) => (
                <motion.div
                  key={item.path}
                  className="klaps-row"
                  onClick={() => nav(item.path)}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.35 + i * 0.07 }}
                  whileTap={{ x: 4 }}
                >
                  <span className="klaps-row-num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="klaps-row-label">{item.label}</span>
                  <span className="klaps-row-sub">{item.sub}</span>
                  <span className="klaps-row-arrow">→</span>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Next category ──────────────────────────── */}
        {nextCat && (
          <motion.div
            className="next-cat-banner"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
          >
            <div className="ncb-label">Następny wieczór</div>
            <div className="ncb-category">{nextCat.category}</div>
            {nextCat.person && (
              <div className="ncb-person">zaproponowane przez <strong>{nextCat.person}</strong></div>
            )}
          </motion.div>
        )}

        <button className="admin-link" onClick={() => nav('/admin')} title="Admin">⚙</button>
      </div>
    </div>
  )
}
