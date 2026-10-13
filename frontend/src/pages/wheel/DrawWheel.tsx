import { useMemo, useRef, useState } from 'react'
import { getErrorMessage } from '../../utils/errors'
import confetti from 'canvas-confetti'
import { deleteLastSpin, finishDraw, startDraw } from '../../api'
import type { DrawMode, DrawResult, WheelData } from '../../api'
import CasinoWheel from '../../components/CasinoWheel'
import { shuffle } from '../scoring/draft'

const MODES: { value: DrawMode; label: string; description: string }[] = [
  { value: 'single', label: 'Jeden temat', description: 'Jedno losowanie tematu i osoby, jak dotychczas.' },
  { value: 'double_theme', label: 'Dwa tematy', description: 'Dwa obroty: różne tematy od dwóch różnych osób.' },
  { value: 'cohost', label: 'Temat + druga osoba', description: 'Najpierw temat, potem druga osoba do wspólnego wybierania filmów.' },
]

// Same comparison as the workbook: ignore decorative emoji and letter case.
const themeKey = (value: string) => value.replace(/[\u2600-\u26ff\u2700-\u27ff\u{10000}-\u{10ffff}]/gu, '').trim().toLowerCase()

export default function DrawWheel({ data, onReload, onBusy, onScoring }: {
  data: WheelData
  onReload: () => void
  onBusy: (busy: boolean) => void
  onScoring: () => void
}) {
  const [draw, setDraw] = useState<DrawResult | null>(data.active_draw ?? null)
  const [mode, setMode] = useState<DrawMode>(data.active_draw?.mode ?? 'single')
  const [busy, setBusy] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [animationItems, setAnimationItems] = useState<string[]>([])
  const [target, setTarget] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  const resultRef = useRef<DrawResult | null>(null)
  const busyRef = useRef(false)
  const first = draw?.picks[0]
  const personStage = !!draw?.pending && mode === 'cohost'
  const choices = useMemo(() => shuffle(personStage
    ? draw!.eligible_people
    : data.entries.filter(e => e.weight > 0).flatMap(e => e.categories
      .filter(c => !draw?.pending || (e.name !== first?.person && themeKey(c) !== themeKey(first?.category ?? '')))
      .map(c => `${c} — ${e.name}`))), [data.entries, draw, first, personStage])
  const setWorking = (value: boolean) => {
    busyRef.current = value
    setBusy(value)
    onBusy(value)
  }

  const spin = async () => {
    if (busyRef.current) return
    setConfirm(false)
    setError('')
    setNote('')
    setWorking(true)
    try {
      const result = draw?.pending ? await finishDraw(draw.id) : await startDraw(mode)
      const pick = result.picks[result.picks.length - 1]
      const label = personStage ? result.hosts[result.hosts.length - 1] : `${pick.category} — ${pick.person}`
      // Freeze the reel throughout the animation, even if the data refreshes.
      const items = choices.includes(label) ? choices : [...choices, label]
      resultRef.current = result
      setAnimationItems(items)
      setTarget(items.indexOf(label))
      setSpinning(true)
    } catch (e) {
      setError(getErrorMessage(e, 'Nie udało się zapisać losowania. Odśwież koło, aby sprawdzić wynik.'))
      setWorking(false)
    }
  }

  const reveal = () => {
    if (!resultRef.current) return
    setDraw(resultRef.current)
    resultRef.current = null
    setSpinning(false)
    setWorking(false)
    onReload()
    confetti({ particleCount: 150, spread: 80, origin: { y: 0.5 } })
  }

  const undo = async () => {
    if (!draw || busyRef.current) return
    setWorking(true)
    setError('')
    try {
      await deleteLastSpin(draw.id)
      setDraw(null)
      setTarget(null)
      setNote('Cofnięto całe losowanie. Tematy wróciły na koło.')
      onReload()
    } catch (e) {
      setError(getErrorMessage(e, 'Nie udało się zapisać losowania. Odśwież koło, aby sprawdzić wynik.'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <fieldset className="draw-modes" disabled={busy || !!draw}>
        <legend>Tryb losowania</legend>
        {MODES.map(option => (
          <label key={option.value} className={`draw-mode ${mode === option.value ? 'draw-mode-selected' : ''}`}>
            <input type="radio" name="draw-mode" value={option.value} checked={mode === option.value}
              onChange={() => { setMode(option.value); setError(''); setConfirm(false) }} />
            <span><strong>{option.label}</strong><small>{option.description}</small></span>
          </label>
        ))}
      </fieldset>
      <details className="draw-odds">
        <summary aria-label="Szanse w pierwszym losowaniu" title="Szanse w pierwszym losowaniu">
          <span aria-hidden="true">ⓘ</span>
        </summary>
        <div className="draw-odds-title">Szanse w pierwszym losowaniu</div>
        <ul>{[...data.entries].sort((a, b) => b.probability - a.probability).map(entry => <li key={entry.key}>
          <strong>{entry.name}</strong>
          <span>{(entry.probability * 100).toLocaleString('pl', { maximumFractionDigits: 2 })}%</span>
          <small>{entry.recency_multiplier === 0 ? 'Pauza po ostatniej nocce' : entry.recency_multiplier === 1 ? 'Bez kary' : entry.nights_ago
            ? `${entry.nights_ago} noce temu · ${((entry.recency_multiplier ?? 1) * 100).toLocaleString('pl', { maximumFractionDigits: 2 })}% wagi`
            : 'Bez kary'}</small>
        </li>)}</ul>
      </details>
      <div className="wheel-main">
        <div className="wheel-area">
          <div className="draw-stage" aria-live="polite">
            {draw?.pending ? (personStage ? '2 / 2 · Losowanie osoby' : '2 / 2 · Losowanie drugiego tematu')
              : draw ? 'Losowanie zakończone' : mode === 'single' ? 'Losowanie tematu' : '1 / 2 · Losowanie tematu'}
          </div>
          <CasinoWheel items={spinning ? animationItems : choices} spinning={spinning}
            targetIndex={target} onAnimationEnd={reveal}
            emptyText="Brak dostępnych losów. Dodaj tematy innych osób lub sprawdź kary w tabeli szans." />
          <button className={`spin-btn ${spinning ? 'spin-btn-spinning' : ''}`}
            disabled={busy || !choices.length || (!!draw && !draw.pending)}
            onClick={() => {
              if (!draw && data.next_category && !data.forced_spin) setConfirm(true)
              else void spin()
            }}>
            {busy ? '…' : draw?.pending ? 'KRĘĆ DALEJ!' : 'KRĘĆ!'}
          </button>
          {personStage && <p className="draw-help">Na kole: {draw.eligible_people.join(', ')}</p>}
        </div>
        <div className="wheel-right">
          {confirm && <div className="spin-confirm">
            <div className="spin-confirm-label">Następna nocka ma już ustawiony temat:</div>
            <div className="spin-confirm-cat">{data.next_category?.category}</div>
            <p>Zastąpić go nowym losowaniem?</p>
            <div className="spin-confirm-actions">
              <button className="btn btn-ghost" onClick={() => setConfirm(false)}>Anuluj</button>
              <button className="btn btn-primary" onClick={() => void spin()}>Tak, losuj</button>
            </div>
          </div>}
          {draw && <div className="result-card" aria-live="polite">
            <div className="result-label">{draw.pending ? 'Pierwszy temat wylosowany' : 'Następna nocka'}</div>
            {draw.picks.map((pick, i) => <div key={i}>
              {mode === 'double_theme' && <div className="result-label">Temat {i + 1}</div>}
              <div className="result-category">{pick.category}</div>
              <div className="result-divider">Temat autorstwa:</div>
              <div className="result-person">{pick.person}</div>
            </div>)}
            {mode === 'cohost' && !draw.pending && <div>
              <div className="result-divider">Wybiera również</div>
              <div className="result-person">{draw.hosts[1]}</div>
            </div>}
            <div className="saved-ok">{draw.pending ? 'Zapisano pierwszy wynik. Zakręć kołem jeszcze raz.' : '✅ Zapisano!'}</div>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void undo()}>
              {draw.pending ? 'Anuluj całe losowanie' : 'Nie zapisuj'}
            </button>
            {!draw.pending && <button className="btn btn-secondary btn-sm" disabled={busy}
              onClick={() => { setDraw(null); setTarget(null); setError('') }}>Nowe losowanie</button>}
            {!draw.pending && <button className="btn btn-ghost btn-sm" disabled={busy}
              onClick={onScoring}>Przejdź do oceniania →</button>}
          </div>}
          {error && <div className="error-msg" role="alert">{error}</div>}
          {note && <div className="saved-ok" role="status">{note}</div>}
        </div>
      </div>
    </>
  )
}
