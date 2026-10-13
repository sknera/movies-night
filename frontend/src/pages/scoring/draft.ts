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
  movieCategories?: Record<string, string>
  people: string[]
  scores: Record<string, Record<string, number | null>>
  movieIdx: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isNames = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim().length > 0)

export function readDraft(): Session | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed) || !isNames(parsed.movies) || !isNames(parsed.people)) return null
    if (!parsed.movies.length || !parsed.people.length || typeof parsed.category !== 'string') return null
    if (typeof parsed.movieIdx !== 'number' || !Number.isInteger(parsed.movieIdx)
      || parsed.movieIdx < 0 || parsed.movieIdx >= parsed.movies.length) return null
    if (!isRecord(parsed.scores) || Object.values(parsed.scores).some(scores => !isRecord(scores)
      || Object.values(scores).some(score => score !== null
        && (typeof score !== 'number' || !Number.isFinite(score) || score < 1 || score > 10)))) return null
    if (parsed.movieCategories !== undefined && (!isRecord(parsed.movieCategories)
      || Object.values(parsed.movieCategories).some(category => typeof category !== 'string')
      || parsed.movies.some(movie => typeof (parsed.movieCategories as Record<string, unknown>)[movie] !== 'string'))) return null
    return {
      movies: parsed.movies, people: parsed.people, category: parsed.category, movieIdx: parsed.movieIdx,
      scores: parsed.scores as Session['scores'], movieCategories: parsed.movieCategories as Session['movieCategories'],
    }
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
