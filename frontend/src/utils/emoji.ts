const FIRST_EMOJI = /\p{Extended_Pictographic}/u

export function splitCategoryName(str: string): { text: string; badge: string } {
  const idx = str.search(FIRST_EMOJI)
  if (idx === -1) return { text: str, badge: '' }
  return {
    text: str.slice(0, idx).trim(),
    badge: str.slice(idx).trim(),
  }
}

export const PERSON_PALETTE = [
  '#c8001a', // site red
  '#8B1A1A', // dark burgundy
  '#7B4000', // rust
  '#8B6000', // warm amber
  '#2C6B3A', // forest green
  '#1A5C8B', // slate blue
  '#1A2A8B', // dark navy
  '#4A1A8B', // indigo
  '#7A1A7A', // plum
  '#28251f', // near black
  '#4A4A4A', // charcoal
  '#5A6B3A', // army green
]
