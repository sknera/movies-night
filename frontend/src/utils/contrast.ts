type RGB = [number, number, number]

function rgb(hex: string): RGB {
  const full = /^#[0-9a-f]{3}$/i.test(hex)
    ? `#${[...hex.slice(1)].map(c => c + c).join('')}` : hex
  if (!/^#[0-9a-f]{6}$/i.test(full)) return [40, 37, 31]
  return [1, 3, 5].map(i => parseInt(full.slice(i, i + 2), 16)) as RGB
}

function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map(v => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string) {
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Choose readable lettering on any person colour, including custom colours. */
export function contrastText(background: string) {
  return contrastRatio('#000000', background) >= contrastRatio('#ffffff', background)
    ? '#000000' : '#ffffff'
}

/** Preserve the hue while making coloured text readable on the light surfaces. */
export function readableColor(color: string, background = '#e8e5de', minimum = 4.5) {
  const channels = rgb(color)
  const target = contrastText(background) === '#000000' ? 0 : 255
  for (let step = 0; step <= 255; step++) {
    const candidate = '#' + channels.map(c => Math.round(c + (target - c) * step / 255)
      .toString(16).padStart(2, '0')).join('')
    if (contrastRatio(candidate, background) >= minimum) return candidate
  }
  return contrastText(background)
}
