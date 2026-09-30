import { motion } from 'framer-motion'
import { avgColor } from '../utils/color'
import { SEASONS } from '../constants/seasons'
import './MovieDetailModal.css'

interface Props {
  title: string
  season: number
  category?: string | null
  host?: string | null
  average: number | null
  scores: Record<string, number>
  onClose: () => void
}

function ScoreAreaChart({ scores }: { scores: Record<string, number> }) {
  const W = 260, H = 72
  const buckets = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const vals = Object.values(scores)

  const counts = buckets.map(s => ({
    s,
    n: vals.filter(v => Math.round(v) === s).length,
  }))

  const maxCount = Math.max(...counts.map(c => c.n), 1)
  const xStep = W / (buckets.length - 1)

  const pts = counts.map(({ s, n }, i) => ({
    x: i * xStep,
    y: n === 0 ? H : H - 4 - (n / maxCount) * (H - 12),
    n,
    s,
  }))

  // Smooth cubic bezier path
  const linePath = pts.reduce((d, pt, i) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`
    const prev = pts[i - 1]
    const cp1x = prev.x + xStep * 0.4
    const cp1y = prev.y
    const cp2x = pt.x - xStep * 0.4
    const cp2y = pt.y
    return `${d} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${pt.x} ${pt.y}`
  }, '')

  const areaPath = `${linePath} L ${W} ${H} L 0 ${H} Z`

  return (
    <div className="mdm-chart">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} overflow="visible">
        <defs>
          <linearGradient id="mdm-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#e74c3c" />
            <stop offset="50%" stopColor="#f39c12" />
            <stop offset="100%" stopColor="#2ecc71" />
          </linearGradient>
          <clipPath id="mdm-clip">
            <rect x="0" y="0" width={W} height={H} />
          </clipPath>
        </defs>
        <path d={areaPath} fill="url(#mdm-grad)" opacity="0.18" clipPath="url(#mdm-clip)" />
        <path d={linePath} fill="none" stroke="url(#mdm-grad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map(({ x, y, n, s }) =>
          n > 0 ? (
            <g key={s}>
              <circle cx={x} cy={y} r={5} fill={avgColor(s)} />
              {n > 0 && (
                <text x={x} y={y - 9} textAnchor="middle" fontSize="10" fill={avgColor(s)} fontWeight="700">
                  {n}
                </text>
              )}
            </g>
          ) : (
            <circle key={s} cx={x} cy={H} r={2} fill="rgba(255,255,255,0.15)" />
          )
        )}
      </svg>
      <div className="mdm-chart-labels">
        {buckets.map(s => (
          <span key={s} style={{ color: avgColor(s) }}>{s}</span>
        ))}
      </div>
    </div>
  )
}

export default function MovieDetailModal({ title, season, category, host, average, scores, onClose }: Props) {
  const sortedScorers = Object.entries(scores).sort(([, a], [, b]) => b - a)
  const seasonData = SEASONS[season]

  return (
    <motion.div
      className="mdm-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="mdm-modal"
        initial={{ scale: 0.88, opacity: 0, y: 24 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.88, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mdm-header">
          <div className="mdm-meta">
            {seasonData && (
              <span className="mdm-season-badge" style={{ background: seasonData.color }}>
                {seasonData.name}
              </span>
            )}
            {category && <span className="mdm-category">{category}</span>}
            {host && <span className="mdm-host">od {host}</span>}
          </div>
          <button className="mdm-close" onClick={onClose}>✕</button>
        </div>

        <div className="mdm-title">{title}</div>

        {average !== null && (
          <div className="mdm-avg" style={{ color: avgColor(average) }}>
            {average.toFixed(2)}
            <span className="mdm-avg-label">/ 10</span>
          </div>
        )}

        {Object.keys(scores).length > 0 && (
          <>
            <ScoreAreaChart scores={scores} />

            <div className="mdm-scores">
              {sortedScorers.map(([person, score]) => (
                <div key={person} className="mdm-score-row">
                  <span className="mdm-score-person">{person}</span>
                  <div className="mdm-score-bar-wrap">
                    <div
                      className="mdm-score-bar"
                      style={{ width: `${(score / 10) * 100}%`, background: avgColor(score) }}
                    />
                  </div>
                  <span className="mdm-score-val" style={{ color: avgColor(score) }}>
                    {score % 1 === 0 ? score.toFixed(0) : score.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {Object.keys(scores).length === 0 && (
          <div className="mdm-no-scores">Brak ocen</div>
        )}
      </motion.div>
    </motion.div>
  )
}
