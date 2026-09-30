import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAttendance } from '../../api'
import type { AttendanceData } from '../../api'
import './AttendancePage.css'

// ── Heatmap ────────────────────────────────────────────────────────────────

const CELL = 13
const GAP = 2
const STEP = CELL + GAP

function Heatmap({ data }: { data: AttendanceData }) {
  const { nights, people } = data
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)

  // Group nights by season for header labels
  const seasonGroups: { season: number; start: number; end: number }[] = []
  let curSeason = -1, curStart = 0
  for (let i = 0; i < nights.length; i++) {
    if (nights[i].season !== curSeason) {
      if (curSeason !== -1) seasonGroups.push({ season: curSeason, start: curStart, end: i - 1 })
      curSeason = nights[i].season
      curStart = i
    }
  }
  if (curSeason !== -1) seasonGroups.push({ season: curSeason, start: curStart, end: nights.length - 1 })

  const NAME_W = 88
  const gridW = nights.length * STEP

  return (
    <div className="att-section">
      <div className="att-section-title">Obecność per noc</div>
      <div className="heatmap-scroll">
        <div className="heatmap-inner" style={{ width: NAME_W + gridW + 8 }}>

          {/* Season header row */}
          <div className="heatmap-season-row" style={{ paddingLeft: NAME_W }}>
            {seasonGroups.map(g => (
              <div
                key={g.season}
                className="heatmap-season-label"
                style={{ width: (g.end - g.start + 1) * STEP - GAP }}
              >
                S{g.season}
              </div>
            ))}
          </div>

          {/* Person rows */}
          {people.map(p => {
            const total = p.attendance.filter(Boolean).length
            return (
              <div key={p.name} className="heatmap-row">
                <div className="heatmap-name" style={{ width: NAME_W, color: p.color }}>
                  {p.name}
                </div>
                <div className="heatmap-cells">
                  {p.attendance.map((attended, i) => (
                    <div
                      key={i}
                      className={`heatmap-cell ${attended ? 'att' : 'miss'}`}
                      style={attended ? { background: p.color } : undefined}
                      onMouseEnter={e => {
                        const rect = (e.target as HTMLElement).getBoundingClientRect()
                        setTooltip({
                          x: rect.left + rect.width / 2,
                          y: rect.top - 8,
                          text: `${p.name} · ${nights[i].name} (S${nights[i].season}) · ${total} nocy`,
                        })
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {tooltip && (
        <div
          className="att-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  )
}

// ── Line chart ─────────────────────────────────────────────────────────────

const PAD = { top: 20, right: 20, bottom: 32, left: 42 }

function LineChart({ data }: { data: AttendanceData }) {
  const { nights, people } = data
  const svgRef = useRef<SVGSVGElement>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [cursor, setCursor] = useState<{ nightIdx: number; x: number } | null>(null)

  const n = nights.length
  if (n === 0 || people.length === 0) return null

  // Compute cumulative attendance per person, ending at last attended night
  const series = people.map(p => {
    let cum = 0
    const points: { x: number; y: number }[] = []
    let lastAttIdx = -1
    for (let i = 0; i < n; i++) {
      if (p.attendance[i]) { cum++; lastAttIdx = i }
      points.push({ x: i, y: cum })
    }
    // Truncate to last attended night
    const trimmed = lastAttIdx >= 0 ? points.slice(0, lastAttIdx + 1) : []
    return { person: p, points: trimmed, total: cum }
  }).filter(s => s.total > 0)

  const maxY = Math.max(...series.map(s => s.total), 1)

  const W = 900, H = 340
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const px = (xi: number) => PAD.left + (xi / (n - 1)) * chartW
  const py = (yi: number) => PAD.top + chartH - (yi / maxY) * chartH

  // Y grid lines
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round((maxY / 4) * i))

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (W / rect.width) - PAD.left
    const nightIdx = Math.max(0, Math.min(n - 1, Math.round((mx / chartW) * (n - 1))))
    setCursor({ nightIdx, x: px(nightIdx) })
  }

  return (
    <div className="att-section">
      <div className="att-section-title">Kumulatywna obecność</div>
      <div className="linechart-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="linechart-svg"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setCursor(null)}
        >
          {/* Y grid + labels */}
          {yTicks.map(v => (
            <g key={v}>
              <line
                x1={PAD.left} x2={W - PAD.right}
                y1={py(v)} y2={py(v)}
                stroke="var(--border-dim)" strokeWidth={0.8}
              />
              <text x={PAD.left - 6} y={py(v) + 4} className="lc-label lc-label-y">{v}</text>
            </g>
          ))}

          {/* X axis season dividers */}
          {nights.map((night, i) => {
            if (i === 0) return null
            if (nights[i - 1].season !== night.season) {
              return (
                <line
                  key={i}
                  x1={px(i)} x2={px(i)}
                  y1={PAD.top} y2={PAD.top + chartH}
                  stroke="var(--ink-muted)" strokeWidth={1} strokeDasharray="4 3"
                />
              )
            }
            return null
          })}

          {/* Lines */}
          {series.map(({ person: p, points }) => {
            if (points.length < 2) return null
            const isHov = hovered === p.name
            const d = points.map((pt, i) =>
              `${i === 0 ? 'M' : 'L'}${px(pt.x).toFixed(1)},${py(pt.y).toFixed(1)}`
            ).join(' ')
            return (
              <path
                key={p.name}
                d={d}
                fill="none"
                stroke={p.color}
                strokeWidth={isHov ? 2.5 : 1.5}
                opacity={hovered && !isHov ? 0.15 : 1}
                style={{ transition: 'opacity 0.15s, stroke-width 0.1s' }}
                onMouseEnter={() => setHovered(p.name)}
                onMouseLeave={() => setHovered(null)}
              />
            )
          })}

          {/* Cursor line */}
          {cursor && (
            <line
              x1={cursor.x} x2={cursor.x}
              y1={PAD.top} y2={PAD.top + chartH}
              stroke="var(--ink)" strokeWidth={0.8} opacity={0.4}
            />
          )}

          {/* Cursor dots + tooltip values */}
          {cursor && hovered && (() => {
            const s = series.find(s => s.person.name === hovered)
            if (!s) return null
            const pt = s.points.find(p => p.x === cursor.nightIdx)
              ?? (cursor.nightIdx > (s.points[s.points.length - 1]?.x ?? -1) ? s.points[s.points.length - 1] : null)
            if (!pt) return null
            return (
              <circle
                cx={px(pt.x)} cy={py(pt.y)} r={4}
                fill={s.person.color} stroke="var(--bg-card)" strokeWidth={1.5}
              />
            )
          })()}

          {/* X axis label */}
          <text
            x={PAD.left + chartW / 2} y={H - 6}
            className="lc-label lc-label-x"
          >
            noc filmowa →
          </text>
        </svg>

        {/* Legend */}
        <div className="linechart-legend">
          {series.map(({ person: p, total }) => (
            <div
              key={p.name}
              className={`lc-legend-item ${hovered === p.name ? 'lc-legend-hov' : ''}`}
              onMouseEnter={() => setHovered(p.name)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="lc-dot" style={{ background: p.color }} />
              <span className="lc-leg-name">{p.name}</span>
              <span className="lc-leg-count">{total}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cursor night name */}

      {cursor && (
        <div className="lc-cursor-label">
          noc {cursor.nightIdx + 1}: {nights[cursor.nightIdx]?.name}
        </div>
      )}
    </div>
  )
}

// ── Dropouts panel ─────────────────────────────────────────────────────────

function DropoutPanel({ data }: { data: AttendanceData }) {
  const { nights, people } = data
  const n = nights.length
  if (n === 0) return null

  const RECENT = 10
  const recentStart = Math.max(0, n - RECENT)

  const entries = people
    .map(p => {
      const lastIdx = p.attendance.reduceRight((found, v, i) => found === -1 && v ? i : found, -1)
      const recentCount = p.attendance.slice(recentStart).filter(Boolean).length
      const total = p.attendance.filter(Boolean).length
      return { name: p.name, color: p.color, lastIdx, recentCount, total }
    })
    .filter(e => e.total >= 3)
    .sort((a, b) => b.lastIdx - a.lastIdx)

  const gone = entries.filter(e => e.recentCount === 0 && e.lastIdx < n - RECENT)
  const active = entries.filter(e => e.recentCount >= 1)

  const Block = ({ title, items, dim }: {
    title: string
    items: typeof entries
    dim?: boolean
  }) => items.length === 0 ? null : (
    <div className="dropout-block">
      <div className="dropout-block-title">{title}</div>
      {items.map(e => (
        <div key={e.name} className="dropout-row" style={{ opacity: dim ? 0.55 : 1 }}>
          <span className="dropout-dot" style={{ background: e.color }} />
          <span className="dropout-name" style={{ color: e.color }}>{e.name}</span>
          <span className="dropout-stat">{e.recentCount}/{RECENT} ostatnich nocy</span>
          <span className="dropout-total">· {e.total} łącznie</span>
        </div>
      ))}
    </div>
  )

  return (
    <div className="att-section">
      <div className="att-section-title">Ostatnie {RECENT} nocy</div>
      <div className="dropout-grid">
        <Block title="✓ Byli" items={active} />
        <Block title="✗ Nie było" items={gone} dim />
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function AttendancePage() {
  const nav = useNavigate()
  const [data, setData] = useState<AttendanceData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAttendance()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading"><div className="spinner" /><span>Ładowanie…</span></div>
  if (!data) return <div className="loading">Błąd ładowania danych.</div>

  return (
    <div className="att-page">
      <div className="page-header">
        <button className="back-btn" onClick={() => nav('/')}>← Wróć</button>
        <span className="page-title">Archiwum 🗓️</span>
      </div>

      <DropoutPanel data={data} />
      <Heatmap data={data} />
      <LineChart data={data} />
    </div>
  )
}
