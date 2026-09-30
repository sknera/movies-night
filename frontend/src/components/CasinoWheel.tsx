import { useRef, useEffect } from 'react'
import './CasinoWheel.css'

const ITEM_H = 64
const VISIBLE = 7
const REPEATS = 16
const CENTER = Math.floor(VISIBLE / 2) * ITEM_H  // 192px

interface Props {
  items: string[]
  spinning: boolean
  targetIndex: number | null
  onAnimationEnd: () => void
}

export default function CasinoWheel({ items, spinning, targetIndex, onAnimationEnd }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const posRef = useRef(0)
  const spinningRef = useRef(false)
  const idleRafRef = useRef(0)

  const N = items.length
  const allItems = N > 0 ? Array.from({ length: REPEATS }, () => items).flat() : []

  // translateY to put item[idx] at center
  const posForIdx = (idx: number) => CENTER - idx * ITEM_H

  // Init at 4*N region
  useEffect(() => {
    if (N === 0) return
    posRef.current = posForIdx(4 * N)
    if (listRef.current) listRef.current.style.transform = `translateY(${posRef.current}px)`
  }, [N])

  // Idle scroll loop
  useEffect(() => {
    if (N === 0) return
    let last = performance.now()

    const frame = (now: number) => {
      if (spinningRef.current) {
        last = now
        idleRafRef.current = requestAnimationFrame(frame)
        return
      }
      const dt = now - last
      last = now

      posRef.current -= 0.05 * dt

      // Keep effective index in [2*N, 6*N]
      let effectiveIdx = (CENTER - posRef.current) / ITEM_H
      while (effectiveIdx > 6 * N) {
        posRef.current += 4 * N * ITEM_H
        effectiveIdx = (CENTER - posRef.current) / ITEM_H
      }

      if (listRef.current) listRef.current.style.transform = `translateY(${posRef.current}px)`
      idleRafRef.current = requestAnimationFrame(frame)
    }

    idleRafRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(idleRafRef.current)
  }, [N])

  // Spin animation
  useEffect(() => {
    if (!spinning || targetIndex === null || N === 0) return
    spinningRef.current = true

    const startY = posRef.current
    const currentIdx = (CENTER - startY) / ITEM_H
    const roundedUp = Math.ceil(currentIdx / N) * N
    const landingIdx = roundedUp + 7 * N + targetIndex
    const endY = posForIdx(landingIdx)

    const duration = 7000 + Math.random() * 2000
    const startTime = performance.now()
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 4)

    let rafId: number
    const animate = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration)
      posRef.current = startY + (endY - startY) * easeOut(t)
      if (listRef.current) listRef.current.style.transform = `translateY(${posRef.current}px)`

      if (t < 1) {
        rafId = requestAnimationFrame(animate)
      } else {
        spinningRef.current = false
        onAnimationEnd()
      }
    }

    rafId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafId)
  }, [spinning, targetIndex])

  if (N === 0) {
    return (
      <div className="casino-wheel-frame">
        <div className="casino-cap"><div className="casino-cap-dot" /></div>
        <div className="casino-wheel casino-wheel-empty">
          <span>Brak kategorii — dodaj przez "+ Kategorie"</span>
        </div>
        <div className="casino-cap casino-cap-bottom"><div className="casino-cap-dot" /></div>
      </div>
    )
  }

  return (
    <div className="casino-wheel-frame">
      <div className="casino-cap"><div className="casino-cap-dot" /></div>
      <div className="casino-wheel">
        <div className="casino-rails">
          <div className="casino-rail-left" />
          <div className="casino-rail-right" />
        </div>
        <div className="casino-highlight" />
        <div className="casino-list-wrap">
          <div className="casino-list" ref={listRef}>
            {allItems.map((item, i) => (
              <div key={i} className="casino-item">
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="casino-cap casino-cap-bottom"><div className="casino-cap-dot" /></div>
    </div>
  )
}
