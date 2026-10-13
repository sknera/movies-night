import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DrawWheel from '../DrawWheel'
import * as api from '../../../api'
import type { DrawResult, WheelData } from '../../../api'

vi.mock('canvas-confetti', () => ({ default: vi.fn() }))
vi.mock('../../../components/CasinoWheel', () => ({
  default: ({ items, spinning, onAnimationEnd }: { items: string[]; spinning: boolean; onAnimationEnd: () => void }) => (
    <div><output data-testid="reel">{items.join('|')}</output>
      {spinning && <button onClick={onAnimationEnd}>Zakończ animację</button>}
    </div>
  ),
}))

const first: DrawResult = {
  id: 'draw-1', mode: 'double_theme', picks: [{ person_key: 'xero', person: 'Xero', category: 'Kosmos' }],
  hosts: ['Xero'], pending: true, eligible_people: ['Kaja'],
}
const data: WheelData = {
  entries: [
    { key: 'xero', name: 'Xero', categories: ['Kosmos', 'Horror'], count: 2, weight: 2, probability: 0.6667, color: '#fff' },
    { key: 'kaja', name: 'Kaja', categories: ['Anime'], count: 1, weight: 1, probability: 0.3333, color: '#aaa' },
  ],
  history: [], next_category: null, forced_spin: null, eligible_people: ['Xero', 'Kaja'],
}

const renderWheel = (over: Partial<WheelData> = {}) => render(<DrawWheel data={{ ...data, ...over }} onReload={vi.fn()} onBusy={vi.fn()} onScoring={vi.fn()} />)

describe('Draw modes', () => {
  beforeEach(() => {
    vi.spyOn(api, 'startDraw').mockResolvedValue(first)
    vi.spyOn(api, 'finishDraw').mockResolvedValue({ ...first, pending: false,
      picks: [...first.picks, { person_key: 'kaja', person: 'Kaja', category: 'Anime' }], hosts: ['Xero', 'Kaja'],
    })
  })

  it('shows odds from highest to lowest without changing the source entries', async () => {
    const user = userEvent.setup()
    const entries = [data.entries[1], data.entries[0], {
      ...data.entries[1], key: 'blocked', name: 'Pauzujący', probability: 0, weight: 0,
    }]
    renderWheel({ entries })
    await user.click(screen.getByLabelText('Szanse w pierwszym losowaniu'))
    const rows = screen.getAllByRole('listitem')
    expect(rows.map(row => within(row).getByRole('strong').textContent)).toEqual(['Xero', 'Kaja', 'Pauzujący'])
    expect(entries.map(entry => entry.name)).toEqual(['Kaja', 'Xero', 'Pauzujący'])
  })

  it('excludes last night selectors from the reel and explains their zero chance', () => {
    renderWheel({ entries: data.entries.map(e => e.name === 'Xero'
      ? { ...e, weight: 0, probability: 0, nights_ago: 1, recency_multiplier: 0 }
      : { ...e, probability: 1 }) })
    expect(screen.getByTestId('reel')).toHaveTextContent(/^Anime — Kaja$/)
    expect(screen.getByText('Pauza po ostatniej nocce')).toBeInTheDocument()
  })

  it('disables drawing when all tickets have zero weight', () => {
    renderWheel({ entries: data.entries.map(e => ({ ...e, weight: 0, probability: 0 })) })
    expect(screen.getByRole('button', { name: 'KRĘĆ!' })).toBeDisabled()
    expect(screen.getByTestId('reel')).toBeEmptyDOMElement()
  })

  it('defaults to the original single mode', async () => {
    const user = userEvent.setup()
    vi.mocked(api.startDraw).mockResolvedValue({ ...first, mode: 'single', pending: false })
    renderWheel()
    expect(screen.getByRole('radio', { name: /Jeden temat/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'KRĘĆ!' }))
    expect(api.startDraw).toHaveBeenCalledWith('single')
    await user.click(await screen.findByRole('button', { name: 'Zakończ animację' }))
    expect(screen.queryByRole('button', { name: 'KRĘĆ DALEJ!' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'KRĘĆ!' })).toBeDisabled()
  })

  it('spins twice for different themes and prevents clicks during animation', async () => {
    const user = userEvent.setup()
    renderWheel()
    await user.click(screen.getByRole('radio', { name: /Dwa tematy/ }))
    await user.click(screen.getByRole('button', { name: 'KRĘĆ!' }))
    expect(api.startDraw).toHaveBeenCalledWith('double_theme')
    expect(screen.getByRole('button', { name: '…' })).toBeDisabled()
    await user.click(await screen.findByRole('button', { name: 'Zakończ animację' }))
    expect(screen.getByTestId('reel')).toHaveTextContent('Anime — Kaja')
    expect(screen.getByTestId('reel')).not.toHaveTextContent('Xero')
    await user.click(screen.getByRole('button', { name: 'KRĘĆ DALEJ!' }))
    expect(api.finishDraw).toHaveBeenCalledWith('draw-1')
    await user.click(await screen.findByRole('button', { name: 'Zakończ animację' }))
    expect(screen.getByText('Temat 1')).toBeInTheDocument()
    expect(screen.getByText('Temat 2')).toBeInTheDocument()
    expect(screen.getByText('✅ Zapisano!')).toBeInTheDocument()
  })

  it('resumes the person-only stage with only eligible scorers on its reel', async () => {
    const user = userEvent.setup()
    vi.mocked(api.finishDraw).mockResolvedValue({ ...first, mode: 'cohost', pending: false, hosts: ['Xero', 'Kaja'] })
    renderWheel({ active_draw: { ...first, mode: 'cohost' } })
    expect(screen.getByTestId('reel')).toHaveTextContent(/^Kaja$/)
    await user.click(screen.getByRole('button', { name: 'KRĘĆ DALEJ!' }))
    expect(api.startDraw).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Zakończ animację' }))
    expect(screen.getByText('Temat autorstwa:').nextElementSibling).toHaveTextContent(/^Xero$/)
    expect(screen.getByText('Wybiera również').nextElementSibling).toHaveTextContent(/^Kaja$/)
    expect(screen.queryByText('Xero i Kaja')).not.toBeInTheDocument()
    expect(screen.getByText('Kosmos')).toBeInTheDocument()
  })

  it('undoes the whole pending draw using its id', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'deleteLastSpin').mockResolvedValue({ ok: true, removed: { person: 'xero', category: 'Kosmos' }, category_restored: true })
    renderWheel({ active_draw: first })
    await user.click(screen.getByRole('button', { name: 'Anuluj całe losowanie' }))
    expect(api.deleteLastSpin).toHaveBeenCalledWith('draw-1')
    expect(await screen.findByText('Cofnięto całe losowanie. Tematy wróciły na koło.')).toBeInTheDocument()
  })

  it('keeps the first result when the second request fails', async () => {
    const user = userEvent.setup()
    vi.mocked(api.finishDraw).mockRejectedValue(new Error('offline'))
    renderWheel({ active_draw: first })
    await user.click(screen.getByRole('button', { name: 'KRĘĆ DALEJ!' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nie udało się zapisać losowania')
    expect(screen.getByText('Kosmos')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'KRĘĆ DALEJ!' })).toBeEnabled())
  })
})
