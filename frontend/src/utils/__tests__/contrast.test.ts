import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, contrastText, readableColor } from '../contrast'
import { avgColor } from '../color'
import { PERSON_PALETTE } from '../emoji'
import { SEASONS } from '../../constants/seasons'

const css = readFileSync(resolve('src/theme.css'), 'utf8')
const token = (name: string) => {
  const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
  if (!value) throw new Error(`Missing theme colour: ${name}`)
  return value
}
const surfaces = ['bg', 'bg-card', 'bg-card2'].map(token)
const levels = [0, 51, 102, 153, 204, 255]
const customColours = levels.flatMap(r => levels.flatMap(g => levels.map(b =>
  '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join(''))))

describe('colour contrast', () => {
  it('uses the reference luminance contrast values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21)
    expect(contrastRatio('#123456', '#123456')).toBe(1)
  })

  it('keeps primary, secondary, error and success text readable on every light surface', () => {
    for (const name of ['ink', 'ink-muted', 'red', 'success', 'error']) {
      for (const background of surfaces) {
        expect(contrastRatio(token(name), background), `${name} on ${background}`).toBeGreaterThanOrEqual(4.5)
      }
    }
    for (const name of ['red', 'success', 'ink']) {
      expect(contrastRatio('#ffffff', token(name))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps input and button borders distinguishable from their surfaces', () => {
    for (const background of surfaces) {
      expect(contrastRatio(token('border-dim'), background)).toBeGreaterThanOrEqual(3)
    }
  })

  it('chooses readable lettering for palette, season and arbitrary person backgrounds', () => {
    for (const color of [...PERSON_PALETTE, ...Object.values(SEASONS).map(s => s.color), ...customColours]) {
      expect(contrastRatio(contrastText(color), color), color).toBeGreaterThanOrEqual(4.5)
      for (const background of surfaces) {
        expect(contrastRatio(readableColor(color), background), color).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps every score colour readable as text and as a badge background', () => {
    for (let score = 1; score <= 10; score += 0.25) {
      const color = avgColor(score)
      for (const background of surfaces) {
        expect(contrastRatio(color, background), `score ${score}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrastRatio(contrastText(color), color)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
