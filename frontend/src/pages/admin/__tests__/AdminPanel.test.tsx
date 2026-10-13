import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import AdminPanel from '../AdminPanel'
import * as api from '../../../api'
import { setAdminToken } from '../../../hooks/useAdminSession'

vi.mock('../../../api', async importOriginal => ({
  ...await importOriginal<typeof api>(),
  adminGetDrawSettings: vi.fn(),
  adminSetDrawSettings: vi.fn(),
  adminGetPeople: vi.fn().mockResolvedValue([]),
  getWheelData: vi.fn().mockResolvedValue({ entries: [], history: [], forced_spin: null }),
  getNextNightDate: vi.fn().mockResolvedValue({ date: null, time: null }),
  getNights: vi.fn().mockResolvedValue([]),
  adminSetNextNightDate: vi.fn(),
  adminLogin: vi.fn().mockResolvedValue({ token: 'verified-login' }),
}))
beforeEach(() => {
  setAdminToken(null)
  vi.mocked(api.adminGetDrawSettings).mockResolvedValue({ initial_penalty: 1, locked: false })
  vi.mocked(api.adminSetDrawSettings).mockResolvedValue({ initial_penalty: 0, locked: false })
  vi.mocked(api.adminGetPeople).mockResolvedValue([])
  vi.mocked(api.getWheelData).mockResolvedValue({ entries: [], history: [], forced_spin: null } as unknown as Awaited<ReturnType<typeof api.getWheelData>>)
  vi.mocked(api.getNextNightDate).mockResolvedValue({ date: null, time: null })
  vi.mocked(api.getNights).mockResolvedValue([])
  vi.mocked(api.adminLogin).mockResolvedValue({ token: 'verified-login' })
})
it('hides administrative options until login succeeds', async () => {
  render(<MemoryRouter><AdminPanel /></MemoryRouter>)
  expect(screen.queryByRole('button', { name: 'Zapisz' })).not.toBeInTheDocument()
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Ustaw zwycięzcę' })).not.toBeInTheDocument()
  const password = screen.getByPlaceholderText('Hasło administratora')
  expect(password).toBeEnabled()
  fireEvent.change(password, { target: { value: 'test-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Zaloguj się' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Zapisz' })).toBeEnabled())
  expect(api.adminLogin).toHaveBeenCalledWith('test-password')
})


it('loads the saved penalty and saves the no-penalty option', async () => {
  sessionStorage.setItem('adminToken', 'verified')
  vi.mocked(api.adminGetDrawSettings).mockResolvedValue({ initial_penalty: .5, locked: false })
  render(<MemoryRouter><AdminPanel /></MemoryRouter>)
  const half = await screen.findByRole('radio', { name: /−50% po ostatniej/ })
  await waitFor(() => expect(half).toBeChecked())
  fireEvent.click(screen.getByRole('radio', { name: /Bez kary/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Zapisz karę' }))
  await screen.findByText('Zapisano ustawienia losowania.')
  expect(api.adminSetDrawSettings).toHaveBeenCalledWith(0, 'verified')
})

it('disables penalty changes while a draw is pending', async () => {
  sessionStorage.setItem('adminToken', 'verified')
  vi.mocked(api.adminGetDrawSettings).mockResolvedValue({ initial_penalty: 1, locked: true })
  render(<MemoryRouter><AdminPanel /></MemoryRouter>)
  await screen.findByText(/Dokończ lub cofnij trwające losowanie/)
  screen.getAllByRole('radio').forEach(option => expect(option).toBeDisabled())
  expect(screen.getByRole('button', { name: 'Zapisz karę' })).toBeDisabled()
})
