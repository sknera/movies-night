import { useState } from 'react'
import { adminLogin } from '../api'
import { setAdminToken } from '../hooks/useAdminSession'
import './AdminPasswordPrompt.css'

/** Inline admin login for actions that happen outside the admin panel.
 *
 * Adding someone to the wheel writes to the workbooks, so it needs the admin
 * password. Sending people to the admin panel mid-night just to come back here
 * is the kind of detour nobody takes, so the password is asked for in place.
 * A successful login reuses the normal session, which unlocks the rest of the
 * admin controls for as long as the tab is open.
 */
export function AdminPasswordPrompt({ label, onSuccess, onCancel }: {
  label: string
  onSuccess: (token: string) => void
  onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!password || busy) return
    setBusy(true)
    setError('')
    try {
      const { token } = await adminLogin(password)
      setAdminToken(token)
      onSuccess(token)
    } catch (e) {
      // The backend answers 403 for a wrong password and 500 when no admin
      // hash is configured; only the first one is the user's problem to fix.
      const status = (e as { response?: { status?: number } })?.response?.status
      setError(status === 403 ? 'Błędne hasło' : 'Nie udało się zalogować')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-prompt" role="group" aria-label={label}>
      <div className="admin-prompt-label">{label}</div>
      <div className="admin-prompt-row">
        <input
          type="password"
          autoFocus
          placeholder="Hasło administratora"
          aria-label="Hasło administratora"
          value={password}
          disabled={busy}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') onCancel()
          }}
        />
        <button className="btn btn-primary btn-sm" disabled={busy || !password} onClick={() => void submit()}>
          {busy ? '…' : 'Potwierdź'}
        </button>
        <button className="btn btn-sm" disabled={busy} onClick={onCancel}>
          Anuluj
        </button>
      </div>
      {error && <div className="error-msg">{error}</div>}
    </div>
  )
}
