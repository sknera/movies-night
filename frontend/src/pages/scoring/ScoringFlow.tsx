import { contrastText, readableColor } from '../../utils/contrast'
import { getErrorMessage } from '../../utils/errors'
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { getPeople, getStats, submitSession, getNextCategory, addPerson } from '../../api'
import { splitCategoryName } from '../../utils/emoji'
import { readDraft, writeDraft, shuffle } from './draft'
import type { Session } from './draft'
import type { NextCategory } from '../../api'
import './ScoringFlow.css'

const SCORE_OPTIONS = Array.from({ length: 19 }, (_, i) => parseFloat((1 + i * 0.5).toFixed(1)))

type Step = 'setup' | 'scoring' | 'done'

// ── Setup ──────────────────────────────────────────────────────────────────
function SetupStep({ allPeople, personColors, onStart, onPersonAdded, defaultThemes }: {
  allPeople: string[]
  personColors: Record<string, string>
  onStart: (movies: string[], cat: string, people: string[], movieCategories?: Record<string, string>) => void
  onPersonAdded: (name: string) => void
  defaultThemes?: NextCategory['themes']
}) {
  const [groups, setGroups] = useState(() => (defaultThemes?.length ? defaultThemes : [{ category: '', person: '' }])
    .map(t => ({ ...t, movies: ['', ''] })))
  const category = groups.map(g => g.category.trim()).join(' + ')
  const [absent, setAbsent] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState('')
  const [addingPerson, setAddingPerson] = useState(false)
  const [addError, setAddError] = useState('')

  const parsedMovies = useMemo(
    () => groups.flatMap(g => g.movies.map(m => m.trim()).filter(Boolean)),
    [groups]
  )
  const duplicate = useMemo(() => {
    const seen = new Set<string>()
    for (const m of parsedMovies) {
      const k = m.toLowerCase()
      if (seen.has(k)) return m
      seen.add(k)
    }
    return null
  }, [parsedMovies])

  const present = allPeople.filter(p => !absent.has(p))
  const canStart = groups.every(g => g.category.trim() && g.movies.some(m => m.trim()))
    && new Set(groups.map(g => g.category.trim().toLowerCase())).size === groups.length
    && present.length > 0 && !duplicate

  const updateGroup = (index: number, changes: Partial<typeof groups[number]>) =>
    setGroups(prev => prev.map((g, i) => i === index ? { ...g, ...changes } : g))

  const toggle = (person: string) =>
    setAbsent(prev => {
      const next = new Set(prev)
      if (next.has(person)) next.delete(person)
      else next.add(person)
      return next
    })

  const handleAddPerson = async () => {
    const name = newName.trim()
    if (!name || addingPerson) return
    setAddingPerson(true)
    setAddError('')
    try {
      await addPerson(name)
      onPersonAdded(name)
      // New arrivals are here tonight — that is why they were just added.
      setAbsent(prev => {
        const next = new Set(prev)
        next.delete(name)
        return next
      })
      setNewName('')
    } catch (e) {
      setAddError(getErrorMessage(e, 'Błąd dodawania'))
    } finally {
      setAddingPerson(false)
    }
  }

  return (
    <div className="setup-step">
      {groups.map((group, groupIndex) => (
        <section className="setup-theme" key={groupIndex} aria-label={`Temat ${groupIndex + 1}`}>
          <div className="setup-group">
            <label className="setup-label" htmlFor={`theme-${groupIndex}`}>
              🏷️ {groups.length > 1 ? `Temat ${groupIndex + 1}` : 'Kategoria'}
              {group.person && <span className="setup-theme-person"> · {group.person}</span>}
            </label>
            <input id={`theme-${groupIndex}`} type="text" placeholder="Kategoria…"
              value={group.category} autoFocus={groupIndex === 0}
              onChange={e => updateGroup(groupIndex, { category: e.target.value })} />
          </div>
          <div className="setup-group">
            <div className="setup-label">📽️ {groups.length > 1 ? `Filmy do tematu ${groupIndex + 1}` : 'Filmy'}</div>
            <div className="movie-inputs">
              {group.movies.map((movie, i) => (
                <div key={i} className="movie-input-row">
                  <span className="movie-input-num">{i + 1}</span>
                  <input type="text" placeholder={`Film ${i + 1}…`}
                    aria-label={groups.length > 1 ? `Temat ${groupIndex + 1}, film ${i + 1}` : `Film ${i + 1}`}
                    value={movie} onChange={e => updateGroup(groupIndex, {
                      movies: group.movies.map((v, j) => j === i ? e.target.value : v),
                    })} />
                </div>
              ))}
              <button className="btn btn-ghost btn-sm add-movie-btn"
                onClick={() => updateGroup(groupIndex, { movies: [...group.movies, ''] })}>
                + Dodaj film
              </button>
            </div>
          </div>
        </section>
      ))}
      {groups.length > 1 && <p className="setup-warning">Wpisz przynajmniej jeden film dla każdego z dwóch różnych tematów.</p>}
      {duplicate && <div className="setup-warning">Dwa razy ten sam film: „{duplicate}” — oceny by się nadpisały.</div>}

      <div className="setup-group">
        <div className="setup-label">
          🙋 Kto jest dziś? <span className="setup-count">{present.length}</span>
        </div>
        <div className="presence-grid">
          {allPeople.map(person => {
            const here = !absent.has(person)
            const color = personColors[person] || '#674EA7'
            return (
              <button
                key={person}
                type="button"
                className={`presence-chip${here ? ' presence-chip-on' : ''}`}
                aria-pressed={here}
                style={here ? { background: color, borderColor: readableColor(color), color: contrastText(color) } : { borderColor: readableColor(color), color: readableColor(color) }}
                onClick={() => toggle(person)}
              >
                {person}
              </button>
            )
          })}
        </div>
        {present.length === 0 && (
          <div className="setup-warning">Zaznacz przynajmniej jedną osobę.</div>
        )}

        <div className="add-person-row setup-add-person">
          <input
            type="text"
            placeholder="Nowa osoba…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddPerson() }}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={addingPerson || !newName.trim()}
            onClick={handleAddPerson}
          >
            {addingPerson ? '…' : '+ Dodaj osobę'}
          </button>
        </div>
        {addError && <div className="error-msg">{addError}</div>}
      </div>

      <button
        className="btn btn-primary btn-lg start-btn"
        disabled={!canStart}
        onClick={() => onStart(parsedMovies, category, present, groups.length > 1
          ? Object.fromEntries(groups.flatMap(g => g.movies.filter(m => m.trim()).map(m => [m.trim(), g.category.trim()])))
          : undefined)}
      >
        Start ({parsedMovies.length} {parsedMovies.length === 1 ? 'film' : parsedMovies.length < 5 ? 'filmy' : 'filmów'}, {present.length} os.)
      </button>
    </div>
  )
}

// ── Scoring ────────────────────────────────────────────────────────────────
function ScoringStep({
  session,
  personColors,
  onScore,
  onPrev,
  onNext,
  onFinish,
  saving,
}: {
  session: Session
  personColors: Record<string, string>
  onScore: (movie: string, person: string, score: number | null) => void
  onPrev: () => void
  onNext: () => void
  onFinish: () => void
  saving: boolean
}) {
  const { movies, people, scores, movieIdx } = session
  const movie = movies[movieIdx]
  const category = session.movieCategories?.[movie] ?? session.category
  const movieScores = scores[movie] ?? {}
  const isFirst = movieIdx === 0
  const isLast = movieIdx === movies.length - 1
  const scored = people.filter(p => movieScores[p] != null).length

  return (
    <div className="scoring-step">
      <div className="scoring-header">
        <div className="scoring-category">
          {splitCategoryName(category).text}
          {splitCategoryName(category).badge && (
            <span style={{ marginLeft: 6 }}>{splitCategoryName(category).badge}</span>
          )}
        </div>
        <div className="scoring-movie-info">
          <span className="movie-num">{movieIdx + 1} / {movies.length}</span>
          <span className="movie-title-big">{movie}</span>
        </div>
        <div className="scoring-progress">oceniło: {scored} / {people.length}</div>
        <div className="movie-dots">
          {movies.map((_, i) => (
            <div key={i} className={`mdot ${i === movieIdx ? 'mdot-active' : i < movieIdx ? 'mdot-done' : ''}`} />
          ))}
        </div>
      </div>

      <div className="scores-table-wrap">
        <div className="scores-table">
          {people.map(person => {
            const color = personColors[person] || '#674EA7'
            const selected = movieScores[person]
            return (
              <div key={person} className="person-col">
                <div className="person-col-name" style={{ borderColor: readableColor(color), color: readableColor(color) }}>
                  <span>{person}</span>
                  {selected != null && (
                    <span className="person-selected-score" style={{ background: color, color: contrastText(color) }}>
                      {(selected as number) % 1 === 0 ? (selected as number).toFixed(0) : (selected as number).toFixed(1)}
                    </span>
                  )}
                </div>
                <div className="score-list">
                  {SCORE_OPTIONS.map(score => (
                    <button
                      key={score}
                      className={`score-btn ${selected === score ? 'score-btn-selected' : ''}`}
                      style={selected === score ? { background: color, borderColor: readableColor(color), color: contrastText(color) } : {}}
                      onClick={() => onScore(movie, person, selected === score ? null : score)}
                    >
                      {score % 1 === 0 ? score.toFixed(0) : score.toFixed(1)}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="scoring-nav">
        <button className="btn btn-secondary" onClick={onPrev} disabled={isFirst}>
          ← Poprzedni
        </button>
        {isLast ? (
          <button className="btn btn-success btn-lg" onClick={onFinish} disabled={saving}>
            {saving ? 'Zapisuję…' : '✓ Zapisz wyniki'}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onNext}>
            Następny →
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function ScoringFlow() {
  const nav = useNavigate()
  const [step, setStep] = useState<Step>('setup')
  const [allPeople, setAllPeople] = useState<string[]>([])
  const [personColors, setPersonColors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [nextCategory, setNextCategory] = useState<NextCategory | null>(null)
  const [draft, setDraft] = useState<Session | null>(() => readDraft())

  const loadPeople = () =>
    Promise.all([getPeople(), getStats()]).then(([people, stats]) => {
      setAllPeople(people)
      setPersonColors(prev => {
        const colors: Record<string, string> = { ...prev }
        for (const s of stats) colors[s.name] = s.color
        return colors
      })
      return people
    })

  useEffect(() => {
    Promise.all([
      loadPeople(),
      getNextCategory(),
    ]).then(([, nextCat]) => {
      setNextCategory(nextCat)
    }).catch(() => setSaveError('Nie udało się pobrać danych nocki. Odśwież stronę.')).finally(() => setLoading(false))
  }, [])

  // Persist after every change: phones lock, browsers reload, and an evening's
  // scoring is far too expensive to retype.
  useEffect(() => {
    if (step === 'scoring' && session) writeDraft(session)
  }, [session, step])

  const handlePersonAdded = (name: string) => {
    setAllPeople(prev => (prev.includes(name) ? prev : [...prev, name]))
    loadPeople().catch(() => {})
  }

  const handleStart = (movies: string[], category: string, people: string[], movieCategories?: Record<string, string>) => {
    const shuffled = shuffle(people)
    const initScores: Session['scores'] = {}
    for (const movie of movies) {
      initScores[movie] = {}
      for (const p of shuffled) initScores[movie][p] = null
    }
    setSession({ movies, category, movieCategories, people: shuffled, scores: initScores, movieIdx: 0 })
    setStep('scoring')
  }

  const handleResumeDraft = () => {
    if (!draft) return
    setSession(draft)
    setDraft(null)
    setStep('scoring')
  }

  const handleDiscardDraft = () => {
    writeDraft(null)
    setDraft(null)
  }

  const handleScore = (movie: string, person: string, score: number | null) => {
    setSession(s => s ? {
      ...s,
      scores: { ...s.scores, [movie]: { ...s.scores[movie], [person]: score } },
    } : s)
  }

  const handleFinish = async () => {
    if (!session) return
    setSaving(true)
    setSaveError(null)
    try {
      await submitSession({
        movies: session.movies,
        category: session.category,
        movie_categories: session.movieCategories,
        present_people: session.people,
        scores: session.scores,
      })
      writeDraft(null)
      setNextCategory(null)
      setStep('done')
    } catch (e) {
      setSaveError(getErrorMessage(e, 'Błąd zapisu'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="loading"><div className="spinner" /><span>Ładowanie…</span></div>

  return (
    <div className="scoring-page">
      <div className="page-header">
        <button className="back-btn" onClick={() => nav('/')}>← Wróć</button>
        <span className="page-title">Ocenianie filmów ⭐</span>
      </div>

      {step === 'setup' && saveError && <div className="error-msg">{saveError}</div>}
      {nextCategory?.pending && <div className="draft-banner">
        <span>Losowanie następnej nocki czeka na drugi obrót koła.</span>
        <button className="btn btn-primary" onClick={() => nav('/wheel')}>Dokończ losowanie</button>
      </div>}
      <AnimatePresence mode="wait">
        {step === 'setup' && !nextCategory?.pending && !saveError && (
          <motion.div key="setup" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {draft && (
              <div className="draft-banner">
                <div className="draft-banner-text">
                  Masz niedokończone ocenianie: <strong>{draft.movies.join(', ')}</strong>
                </div>
                <div className="draft-banner-actions">
                  <button className="btn btn-primary btn-sm" onClick={handleResumeDraft}>Kontynuuj</button>
                  <button className="btn btn-ghost btn-sm" onClick={handleDiscardDraft}>Zacznij od nowa</button>
                </div>
              </div>
            )}
            <SetupStep
              allPeople={allPeople}
              personColors={personColors}
              onStart={handleStart}
              onPersonAdded={handlePersonAdded}
              defaultThemes={nextCategory?.themes ?? (nextCategory ? [{ category: nextCategory.category, person: nextCategory.person }] : undefined)}
            />
          </motion.div>
        )}

        {step === 'scoring' && session && (
          <motion.div key="scoring" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {saveError && <div className="error-msg">{saveError}</div>}
            <ScoringStep
              session={session}
              personColors={personColors}
              onScore={handleScore}
              onPrev={() => setSession(s => s ? { ...s, movieIdx: Math.max(0, s.movieIdx - 1) } : s)}
              onNext={() => setSession(s => s ? { ...s, movieIdx: Math.min(s.movies.length - 1, s.movieIdx + 1) } : s)}
              onFinish={handleFinish}
              saving={saving}
            />
          </motion.div>
        )}

        {step === 'done' && session && (
          <motion.div key="done" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="done-screen">
            <div className="done-icon">✅</div>
            <h2>Zapisano!</h2>
            <div className="done-summary">
              <strong>{session.category}</strong> — {session.movies.join(', ')}
            </div>
            <div className="done-actions">
              <button className="btn btn-primary btn-lg" onClick={() => nav('/wheel')}>Dodaj kategorie i kręć! 🎡</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setSession(null); setStep('setup') }}>Nowa sesja</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
