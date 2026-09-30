/**
 * Adding a person on the "dodaj kategorie" screen must leave you on that
 * screen: the whole reason to add them there is that they now have to type
 * their own categories. An earlier build wired the add-person handler to the
 * same callback as the "go to the wheel" footer button, so the grid vanished
 * the moment the person was created.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WheelPage from '../WheelPage'
import * as api from '../../../api'
import type { WheelData, WheelEntry } from '../../../api'

vi.mock('canvas-confetti', () => ({ default: vi.fn() }))

function entry(over: Partial<WheelEntry> = {}): WheelEntry {
  return {
    key: 'xero', name: 'Xero', categories: ['Horrory'], count: 1,
    weight: 1, probability: 1, color: '#d84b4b', ...over,
  }
}

function wheelData(entries: WheelEntry[]): WheelData {
  return { entries, history: [], next_category: null, forced_spin: null }
}

describe('AddCategoriesView', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getWheelData').mockResolvedValue(wheelData([entry()]))
  })

  it('stays on the categories grid after adding a person', async () => {
    const user = userEvent.setup()
    const added = wheelData([
      entry(),
      entry({ key: 'zosia', name: 'Zosia', categories: [], count: 0, probability: 0 }),
    ])
    vi.spyOn(api, 'addPerson').mockImplementation(async () => {
      vi.mocked(api.getWheelData).mockResolvedValue(added)
      return { ok: true, created_scores: true, created_wheel: true, color: '#4bd8c1' }
    })

    render(<MemoryRouter><WheelPage /></MemoryRouter>)
    expect(await screen.findByText('Dodaj kategorie')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Imię nowej osoby…'), 'Zosia')
    await user.click(screen.getByRole('button', { name: 'Dodaj' }))

    // The new person's card is here, on the same screen...
    expect(await screen.findByRole('button', { name: /Zosia/ })).toBeInTheDocument()
    // ...and the wheel has not taken over.
    expect(screen.getByText('Dodaj kategorie')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'KRĘĆ!' })).not.toBeInTheDocument()
  })

  it('offers the new person a category box straight away', async () => {
    const user = userEvent.setup()
    const added = wheelData([
      entry(),
      entry({ key: 'zosia', name: 'Zosia', categories: [], count: 0, probability: 0 }),
    ])
    vi.spyOn(api, 'addPerson').mockImplementation(async () => {
      vi.mocked(api.getWheelData).mockResolvedValue(added)
      return { ok: true, created_scores: true, created_wheel: true, color: '#4bd8c1' }
    })
    const addCategories = vi.spyOn(api, 'addCategories').mockResolvedValue({ data: { ok: true } } as never)

    render(<MemoryRouter><WheelPage /></MemoryRouter>)
    await screen.findByText('Dodaj kategorie')

    await user.type(screen.getByPlaceholderText('Imię nowej osoby…'), 'Zosia')
    await user.click(screen.getByRole('button', { name: 'Dodaj' }))
    await screen.findByRole('button', { name: /Zosia/ })

    const boxes = await screen.findAllByPlaceholderText('Nowa kategoria…')
    expect(boxes).toHaveLength(2)

    const zosiaBox = boxes.find(b => (b as HTMLInputElement).dataset.catInput === 'zosia')!
    await user.type(zosiaBox, 'Kino drogi{Enter}')
    await waitFor(() => expect(addCategories).toHaveBeenCalledWith({ zosia: ['Kino drogi'] }))
  })

  it('only leaves for the wheel when the footer button is pressed', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><WheelPage /></MemoryRouter>)
    await screen.findByText('Dodaj kategorie')

    await user.click(screen.getByRole('button', { name: 'Przejdź do koła →' }))
    expect(await screen.findByRole('button', { name: 'KRĘĆ!' })).toBeInTheDocument()
  })

  it('shows the server error when a category cannot be saved', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'addCategories').mockRejectedValue({
      response: { data: { detail: 'Nie znaleziono osoby na kole: xero' } },
    })

    render(<MemoryRouter><WheelPage /></MemoryRouter>)
    await screen.findByText('Dodaj kategorie')

    await user.type(screen.getByPlaceholderText('Nowa kategoria…'), 'Cokolwiek{Enter}')

    expect(await screen.findByText(/Nie znaleziono osoby na kole/)).toBeInTheDocument()
    // No green "saved" tick for something that was not saved.
    expect(screen.queryByText(/✓ Dodano/)).not.toBeInTheDocument()
  })
})
