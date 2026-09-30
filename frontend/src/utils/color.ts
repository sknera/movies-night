export function avgColor(avg: number): string {
  const t = Math.max(0, Math.min(1, (avg - 1) / 9))
  const hue = Math.round(t * 120)
  return `hsl(${hue}, 75%, 55%)`
}
