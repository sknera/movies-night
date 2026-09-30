/**
 * An evening's scoring, kept in localStorage while it is in progress.
 *
 * A movie night is a lot of taps on someone's phone; a lock screen, an
 * accidental back gesture or a reload would otherwise throw all of it away.
 */

export const DRAFT_KEY = 'movienight.scoringDraft.v1'

export interface Session {
  movies: string[]
  category: string
  people: string[]
  scores: Record<string, Record<string, number | null>>
  movieIdx: number
}

export function readDraft(): Session | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.movies) || !Array.isArray(parsed.people)) return null
    if (parsed.movies.length === 0) return null
    return parsed as Session
  } catch {
    // Corrupted or unavailable storage is the same as no draft.
    return null
  }
}

export function writeDraft(session: Session | null) {
  try {
    if (session) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(session))
    else window.localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Private mode / quota — scoring still works, it just isn't recoverable.
  }
}

/** Fisher–Yates. `sort(() => Math.random() - 0.5)` is not a uniform shuffle. */
export function shuffle<T>(input: T[]): T[] {
  const out = [...input]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
