import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAdminSession, setAdminToken } from '../useAdminSession'
import { adminGetPeople } from '../../api'

vi.mock('../../api', () => ({ adminGetPeople: vi.fn() }))
function Controls() {
  const token = useAdminSession()
  return <button disabled={!token}>{token ? 'Edytuj' : 'Tylko dla administratora'}</button>
}
beforeEach(() => {
  setAdminToken(null)
  vi.mocked(adminGetPeople).mockReset()
})
describe('verified administrator permissions', () => {
  it('keeps anonymous controls visible and disabled without an API request', () => {
    render(<Controls />)
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByText('Tylko dla administratora')).toBeVisible()
    expect(adminGetPeople).not.toHaveBeenCalled()
  })
  it('does not trust stored tokens until the server validates them', async () => {
    sessionStorage.setItem('adminToken', 'saved')
    let finish!: () => void
    vi.mocked(adminGetPeople).mockImplementation(() => new Promise(resolve => { finish = () => resolve([]) }))
    render(<Controls />)
    expect(screen.getByRole('button')).toBeDisabled()
    await act(async () => finish())
    expect(screen.getByRole('button')).toBeEnabled()
    expect(adminGetPeople).toHaveBeenCalledWith('saved')
  })
  it('removes expired tokens and leaves controls disabled', async () => {
    sessionStorage.setItem('adminToken', 'expired')
    vi.mocked(adminGetPeople).mockRejectedValue(new Error('401'))
    render(<Controls />)
    await waitFor(() => expect(sessionStorage.getItem('adminToken')).toBeNull())
    expect(screen.getByRole('button')).toBeDisabled()
  })
  it('updates every consumer on login, rejection and logout', () => {
    render(<><Controls /><Controls /></>)
    act(() => setAdminToken('new'))
    screen.getAllByRole('button').forEach(button => expect(button).toBeEnabled())
    act(() => window.dispatchEvent(new CustomEvent('admin-session-expired', { detail: 'old' })))
    screen.getAllByRole('button').forEach(button => expect(button).toBeEnabled())
    act(() => window.dispatchEvent(new CustomEvent('admin-session-expired', { detail: 'new' })))
    screen.getAllByRole('button').forEach(button => expect(button).toBeDisabled())
    act(() => setAdminToken('next'))
    act(() => setAdminToken(null))
    screen.getAllByRole('button').forEach(button => expect(button).toBeDisabled())
  })
  it('checks again when returning to the application', async () => {
    render(<Controls />)
    act(() => setAdminToken('valid'))
    vi.mocked(adminGetPeople).mockRejectedValue(new Error('server restarted'))
    fireEvent.focus(window)
    expect(screen.getByRole('button')).toBeDisabled()
    await waitFor(() => expect(sessionStorage.getItem('adminToken')).toBeNull())
  })
})
