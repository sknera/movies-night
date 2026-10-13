import { describe, expect, it } from 'vitest'
import { DRAFT_KEY, readDraft, writeDraft } from '../draft'

const draft = { movies: ['Film'], category: 'Kosmos', people: ['Kaja'], scores: { Film: { Kaja: 8 } }, movieIdx: 0 }

describe('draft validation', () => {
  it('keeps valid drafts compatible with the original single-theme format', () => {
    writeDraft(draft)
    expect(readDraft()).toEqual(draft)
  })

  it.each([
    { movieIdx: 10 }, { movieIdx: -1 }, { movieIdx: 0.5 }, { movies: [42] },
    { people: [] }, { scores: null }, { scores: { Film: { Kaja: 20 } } },
    { movieCategories: { Film: null } },
  ])('ignores a damaged draft instead of crashing the scoring screen: %j', change => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, ...change }))
    expect(readDraft()).toBeNull()
  })
})
