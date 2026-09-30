import { useRef, useEffect, useCallback } from 'react'
import type { WheelEntry } from '../api'

interface Props {
  entries: WheelEntry[]
  spinning: boolean
  targetIndex: number | null
  onAnimationEnd: () => void
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 4)
}

export default function SpinWheel({ entries, spinning, targetIndex, onAnimationEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rotationRef = useRef(0)
  const animRef = useRef<number>(0)
  const spinningRef = useRef(false)

  const totalWeight = entries.reduce((s, e) => s + e.probability, 0)

  const getSegments = useCallback(() => {
    let cumulative = 0
    return entries.map((entry) => {
      const start = (cumulative / totalWeight) * 2 * Math.PI - Math.PI / 2
      cumulative += entry.probability
      const end = (cumulative / totalWeight) * 2 * Math.PI - Math.PI / 2
      return { entry, start, end, color: entry.color || '#674EA7' }
    })
  }, [entries, totalWeight])

  const draw = useCallback((rotation: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const { width, height } = canvas
    const cx = width / 2
    const cy = height / 2
    const r = Math.min(cx, cy) - 8

    ctx.clearRect(0, 0, width, height)

    // Outer glow ring
    const gradient = ctx.createRadialGradient(cx, cy, r - 12, cx, cy, r + 12)
    gradient.addColorStop(0, 'rgba(103,78,167,0.5)')
    gradient.addColorStop(1, 'transparent')
    ctx.beginPath()
    ctx.arc(cx, cy, r + 8, 0, 2 * Math.PI)
    ctx.fillStyle = gradient
    ctx.fill()

    const segments = getSegments()

    for (const { start, end, color, entry } of segments) {
      const adjStart = start + rotation
      const adjEnd = end + rotation

      // Segment fill
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, r, adjStart, adjEnd)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()

      // Segment border
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, r, adjStart, adjEnd)
      ctx.closePath()
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Text
      const midAngle = (adjStart + adjEnd) / 2
      const textR = r * 0.68
      const tx = cx + textR * Math.cos(midAngle)
      const ty = cy + textR * Math.sin(midAngle)

      ctx.save()
      ctx.translate(tx, ty)
      ctx.rotate(midAngle + Math.PI / 2)

      const segAngle = adjEnd - adjStart
      const maxWidth = 2 * Math.sin(segAngle / 2) * r * 0.68 - 6

      // Name
      const fontSize = Math.max(9, Math.min(14, maxWidth / (entry.name.length * 0.55)))
      ctx.font = `bold ${fontSize}px 'Segoe UI', sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const displayName = entry.name.length > 10 ? entry.name.slice(0, 9) + '…' : entry.name
      ctx.fillText(displayName, 0, -fontSize * 0.6)

      // Category count badge
      ctx.font = `${Math.max(7, fontSize - 2)}px 'Segoe UI', sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.fillText(`${entry.count}`, 0, fontSize * 0.6)

      ctx.restore()
    }

    // Center hub
    const hubGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.12)
    hubGrad.addColorStop(0, '#a383da')
    hubGrad.addColorStop(1, '#3d2778')
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.1, 0, 2 * Math.PI)
    ctx.fillStyle = hubGrad
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.lineWidth = 2
    ctx.stroke()

    // Pointer (top)
    ctx.save()
    ctx.translate(cx, 4)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(-14, -22)
    ctx.lineTo(14, -22)
    ctx.closePath()
    ctx.fillStyle = '#fff'
    ctx.shadowColor = 'rgba(103,78,167,0.8)'
    ctx.shadowBlur = 10
    ctx.fill()
    ctx.restore()
  }, [getSegments])

  // Idle gentle rotation
  useEffect(() => {
    if (spinningRef.current) return
    let raf: number
    let t = rotationRef.current
    const idle = () => {
      if (spinningRef.current) return
      t += 0.002
      rotationRef.current = t
      draw(t)
      raf = requestAnimationFrame(idle)
    }
    raf = requestAnimationFrame(idle)
    return () => cancelAnimationFrame(raf)
  }, [draw, spinning])

  // Spin animation
  useEffect(() => {
    if (!spinning || targetIndex === null) return
    spinningRef.current = true
    cancelAnimationFrame(animRef.current)

    const segments = getSegments()
    const target = segments[targetIndex]
    const targetAngle = -((target.start + target.end) / 2 + Math.PI / 2)
    const fullRotations = (5 + Math.floor(Math.random() * 4)) * 2 * Math.PI
    const startRotation = rotationRef.current
    const endRotation = startRotation + fullRotations + (targetAngle - ((startRotation + fullRotations) % (2 * Math.PI)))

    const duration = 5500 + Math.random() * 1500
    const startTime = performance.now()

    const animate = (now: number) => {
      const elapsed = now - startTime
      const t = Math.min(1, elapsed / duration)
      const eased = easeOut(t)
      const current = startRotation + (endRotation - startRotation) * eased
      rotationRef.current = current
      draw(current)

      if (t < 1) {
        animRef.current = requestAnimationFrame(animate)
      } else {
        spinningRef.current = false
        onAnimationEnd()
      }
    }

    animRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animRef.current)
  }, [spinning, targetIndex, draw, getSegments, onAnimationEnd])

  // Initial draw
  useEffect(() => {
    draw(rotationRef.current)
  }, [draw])

  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={480}
      style={{ maxWidth: '100%', display: 'block' }}
    />
  )
}
