import { useEffect, useState } from 'react'
import { adminGetDrawSettings, adminSetDrawSettings } from '../../api'
import type { DrawPenalty } from '../../api'
import { getErrorMessage } from '../../utils/errors'

export default function DrawSettings({ token }: { token: string | null }) {
  const [penalty, setPenalty] = useState<DrawPenalty>(0.5)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!token) return
    let active = true
    adminGetDrawSettings(token).then(settings => {
      if (!active) return
      setPenalty(settings.initial_penalty)
      setLocked(settings.locked)
      setLoadedFor(token)
      setError('')
    }).catch(e => { if (active) setError(getErrorMessage(e, 'Nie udało się pobrać ustawień losowania.')) })
    return () => { active = false }
  }, [token])
  const disabled = !token || loadedFor !== token || locked || saving
  const save = async () => {
    if (disabled) return
    setSaving(true)
    setMessage('')
    setError('')
    try {
      await adminSetDrawSettings(penalty, token)
      setMessage('Zapisano ustawienia losowania.')
    } catch (e) {
      setError(getErrorMessage(e, 'Nie udało się zapisać ustawień losowania.'))
    } finally {
      setSaving(false)
    }
  }
  return <section className="admin-section">
    <h2 className="admin-section-title">Kara za niedawny wybór</h2>
    <p>Kara dotyczy wybierających filmy na ostatnich nockach, a nie wszystkich obecnych. Obejmuje temat i dodatkową osobę.</p>
    <fieldset className="admin-controls" disabled={disabled}>
      <legend>Początkowa kara</legend>
      <div className="draw-penalty-options">
        {([
          [1, '−100% po ostatniej nocce', 'Następnie −50%, −25%, −12,5%…'],
          [0.5, '−50% po ostatniej nocce', 'Następnie −25%, −12,5%, −6,25%…'],
          [0, 'Bez kary', 'Szansa tematu zależy tylko od liczby dostępnych tematów na kole. Dodatkowe osoby mają równe szanse.'],
        ] as const).map(([value, label, description]) => <label key={value}>
          <input type="radio" name="draw-penalty" value={value} checked={penalty === value}
            onChange={() => { setPenalty(value); setMessage('') }} />
          <span><strong>{label}</strong><small>{description}</small></span>
        </label>)}
      </div>
      <button className="btn btn-primary" onClick={save}>{saving ? 'Zapisywanie…' : 'Zapisz karę'}</button>
    </fieldset>
    {!token && <p className="admin-only-note">Tylko dla administratora</p>}
    {locked && <p>Dokończ lub cofnij trwające losowanie, aby zmienić karę.</p>}
    {message && <p role="status">{message}</p>}
    {error && <p className="error-msg" role="alert">{error}</p>}
  </section>
}
