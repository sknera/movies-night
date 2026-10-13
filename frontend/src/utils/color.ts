import { readableColor } from './contrast'

export function avgColor(avg: number): string {
  const t = Math.max(0, Math.min(1, (avg - 1) / 9))
  const hue = Math.round(t * 120)
  const saturation = 0.75, lightness = 0.55
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1))
  const channels = hue < 60 ? [chroma, x, 0] : [x, chroma, 0]
  const offset = lightness - chroma / 2
  const hex = '#' + channels.map(c => Math.round((c + offset) * 255).toString(16).padStart(2, '0')).join('')
  return readableColor(hex)
}
