import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ScoringFlow from '../ScoringFlow'
import { DRAFT_KEY } from '../draft'
import * as api from '../../../api'

const PEOPLE = ['Xero', 'Kaja', 'Bartosz']

function stubApi(over: { people?: string[]; nextCategory?: string | null } = {}) {
  vi.spyOn(api, 'getPeople').mockResolvedValue(over.people ?? PEOPLE)
  vi.spyOn(api, 'getStats').mockResolvedValue(
    (over.people ?? PEOPLE).map(name => ({
      name, watched: 10, average: 7, color: '#d84b4b', nights_ago: 0,
    }))
  )
  vi.spyOn(api, 'getNextCategory').mockResolvedValue(
    over.nextCategory === null ? null : { category: over.nextCategory ?? 'Horrory', person: 'Xero' }
  )
  vi.spyOn(api, 'getLastSpin').mockResolvedValue({ spin: null })
}

const renderFlow = () => render(<MemoryRouter><ScoringFlow /></MemoryRouter>)

/** Fills in the setup step and presses Start. */
async function startSession(user: ReturnType<typeof userEvent.setup>, movies = ['Film A', 'Film B']) {
  const inputs = screen.getAllByPlaceholderText(/^Film \d…$/)
  for (let i = 0; i < movies.length; i++) await user.type(inputs[i], movies[i])
  await user.click(screen.getByRole('button', { name: /^Start/ }))
}

describe('ScoringFlow setup', () => {
  beforeEach(() => stubApi())

  it('prefills the category the wheel picked for tonight', async () => {
    renderFlow()
    const category = await screen.findByPlaceholderText('Kategoria…')
    await waitFor(() => expect(category).toHaveValue('Horrory'))
  })

  it('falls back to the last spin when no category is set', async () => {
    vi.spyOn(api, 'getNextCategory').mockResolvedValue(null)
    vi.spyOn(api, 'getLastSpin').mockResolvedValue({
      spin: { person: 'kaja', category: 'Anime', row_index: 2 },
    })
    renderFlow()
    const category = await screen.findByPlaceholderText('Kategoria…')
    await waitFor(() => expect(category).toHaveValue('Anime'))
  })

  it('lists everyone as present by default', async () => {
    renderFlow()
    for (const person of PEOPLE) {
      expect(await screen.findByRole('button', { name: person })).toHaveAttribute('aria-pressed', 'true')
    }
    expect(await screen.findByRole('button', { name: /^Start/ })).toHaveTextContent('3 os.')
  })

  it('drops a column for someone who is not here tonight', async () => {
    const user = userEvent.setup()
    renderFlow()
    await screen.findByRole('button', { name: 'Kaja' })

    await user.click(screen.getByRole('button', { name: 'Kaja' }))
    expect(screen.getByRole('button', { name: 'Kaja' })).toHaveAttribute('aria-pressed', 'false')

    await startSession(user)

    const table = await screen.findByText('Film A')
    expect(table).toBeInTheDocument()
    expect(screen.getByText('oceniło: 0 / 2')).toBeInTheDocument()
    expect(screen.queryByText('Kaja')).not.toBeInTheDocument()
  })

  it('refuses to start with nobody present', async () => {
    const user = userEvent.setup()
    renderFlow()
    await screen.findByRole('button', { name: 'Xero' })
    for (const person of PEOPLE) await user.click(screen.getByRole('button', { name: person }))

    await user.type(screen.getAllByPlaceholderText(/^Film \d…$/)[0], 'Film A')
    expect(screen.getByRole('button', { name: /^Start/ })).toBeDisabled()
    expect(screen.getByText(/Zaznacz przynajmniej jedną osobę/)).toBeInTheDocument()
  })

  it('refuses two movies with the same title', async () => {
    const user = userEvent.setup()
    renderFlow()
    await screen.findByRole('button', { name: 'Xero' })

    const inputs = screen.getAllByPlaceholderText(/^Film \d…$/)
    await user.type(inputs[0], 'Ten Sam')
    await user.type(inputs[1], 'ten sam')

    expect(screen.getByText(/Dwa razy ten sam film/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Start/ })).toBeDisabled()
  })
})

describe('ScoringFlow add person', () => {
  beforeEach(() => stubApi())

  it('adds a newcomer and marks them present without leaving the screen', async () => {
    const user = userEvent.setup()
    const addPerson = vi.spyOn(api, 'addPerson').mockImplementation(async () => {
      vi.mocked(api.getPeople).mockResolvedValue([...PEOPLE, 'Zosia'])
      vi.mocked(api.getStats).mockResolvedValue(
        [...PEOPLE, 'Zosia'].map(name => ({
          name, watched: 1, average: 7, color: '#4bd8c1', nights_ago: 0,
        }))
      )
      return { ok: true, created_scores: true, created_wheel: true, color: '#4bd8c1' }
    })

    renderFlow()
    await screen.findByRole('button', { name: 'Xero' })

    await user.type(screen.getByPlaceholderText('Nowa osoba…'), 'Zosia')
    await user.click(screen.getByRole('button', { name: '+ Dodaj osobę' }))

    expect(addPerson).toHaveBeenCalledWith('Zosia')
    const chip = await screen.findByRole('button', { name: 'Zosia' })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    // Still on the setup step.
    expect(screen.getByPlaceholderText('Kategoria…')).toBeInTheDocument()
  })

  it('gives the newcomer a scoring column', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'addPerson').mockImplementation(async () => {
      vi.mocked(api.getPeople).mockResolvedValue([...PEOPLE, 'Zosia'])
      return { ok: true, created_scores: true, created_wheel: true, color: '#4bd8c1' }
    })
    const submit = vi.spyOn(api, 'submitSession').mockResolvedValue({ data: { ok: true } } as never)

    renderFlow()
    await screen.findByRole('button', { name: 'Xero' })
    await user.type(screen.getByPlaceholderText('Nowa osoba…'), 'Zosia')
    await user.click(screen.getByRole('button', { name: '+ Dodaj osobę' }))
    await screen.findByRole('button', { name: 'Zosia' })

    await startSession(user, ['Film A'])

    expect(await screen.findByText('oceniło: 0 / 4')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '✓ Zapisz wyniki' }))

    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0].present_people).toContain('Zosia')
  })

  it('shows the error when the newcomer cannot be added', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'addPerson').mockRejectedValue({
      response: { data: { detail: 'Name required' } },
    })

    renderFlow()
    await screen.findByRole('button', { name: 'Xero' })
    await user.type(screen.getByPlaceholderText('Nowa osoba…'), 'Zosia')
    await user.click(screen.getByRole('button', { name: '+ Dodaj osobę' }))

    expect(await screen.findByText('Name required')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zosia' })).not.toBeInTheDocument()
  })
})

describe('ScoringFlow scoring and saving', () => {
  beforeEach(() => stubApi())

  it('records a score against the right person and movie', async () => {
    const user = userEvent.setup()
    const submit = vi.spyOn(api, 'submitSession').mockResolvedValue({ data: { ok: true } } as never)

    renderFlow()
    await screen.findByRole('button', { name: 'Xero' })
    await startSession(user, ['Film A'])
    await screen.findByText('Film A')

    const column = screen.getByText('Xero').closest('.person-col')!
    await user.click(within(column as HTMLElement).getByRole('button', { name: '8' }))
    expect(await screen.findByText('oceniło: 1 / 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '✓ Zapisz wyniki' }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0][0].scores['Film A'].Xero).toBe(8)
  })

  it('walks through both movies before saving', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'submitSession').mockResolvedValue({ data: { ok: true } } as never)

    renderFlow()
    await screen.findByRole('button', { name: 'Xero' })
    await startSession(user, ['Film A', 'Film B'])

    expect(await screen.findByText('Film A')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '✓ Zapisz wyniki' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Następny →' }))
    expect(await screen.findByText('Film B')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '✓ Zapisz wyniki' })).toBeInTheDocument()
  })

  it('keeps the screen open and shows why when the save fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'submitSession').mockRejectedValue({
      response: { data: { detail: 'Powtórzony tytuł filmu: Film A' } },
    })

    renderFlow()
    await screen.findByRole('button', { name: 'Xero' })
    await startSession(user, ['Film A'])
    await screen.findByText('Film A')

    await user.click(screen.getByRole('button', { name: '✓ Zapisz wyniki' }))
    expect(await screen.findByText('Powtórzony tytuł filmu: Film A')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '✓ Zapisz wyniki' })).toBeInTheDocument()
  })
})

describe('ScoringFlow draft recovery', () => {
  beforeEach(() => stubApi())

  it('saves a draft while scoring', async () => {
    const user = userEvent.setup()
    renderFlow()
    await screen.findByRole('button', { name: 'Xero' })
    await startSession(user, ['Film A'])
    await screen.findByText('Film A')

    const column = screen.getByText('Xero').closest('.person-col')!
    await user.click(within(column as HTMLElement).getByRole('button', { name: '8' }))

    await waitFor(() => {
      const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY)!)
      expect(draft.scores['Film A'].Xero).toBe(8)
    })
  })

  it('offers to continue an interrupted night', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
      movies: ['Film A'], category: 'Horrory', people: ['Xero', 'Kaja'],
      scores: { 'Film A': { Xero: 8, Kaja: null } }, movieIdx: 0,
    }))

    renderFlow()
    expect(await screen.findByText(/niedokończone ocenianie/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Kontynuuj' }))
    // "Film A" also appears in the banner, so assert on the scoring step itself:
    // the score kept from the draft is the point.
    expect(await screen.findByText('oceniło: 1 / 2')).toBeInTheDocument()
    expect(document.querySelector('.movie-title-big')).toHaveTextContent('Film A')
  })

  it('throws the draft away on request', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
      movies: ['Film A'], category: 'Horrory', people: ['Xero'],
      scores: { 'Film A': { Xero: 8 } }, movieIdx: 0,
    }))

    renderFlow()
    await user.click(await screen.findByRole('button', { name: 'Zacznij od nowa' }))

    expect(screen.queryByText(/niedokończone ocenianie/)).not.toBeInTheDocument()
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('clears the draft once the night is saved', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'submitSession').mockResolvedValue({ data: { ok: true } } as never)

    renderFlow()
    await screen.findByRole('button', { name: 'Xero' })
    await startSession(user, ['Film A'])
    await screen.findByText('Film A')
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull())

    await user.click(screen.getByRole('button', { name: '✓ Zapisz wyniki' }))
    expect(await screen.findByText('Zapisano!')).toBeInTheDocument()
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('ignores a corrupted draft', async () => {
    window.localStorage.setItem(DRAFT_KEY, 'not json')
    renderFlow()
    expect(await screen.findByPlaceholderText('Kategoria…')).toBeInTheDocument()
    expect(screen.queryByText(/niedokończone ocenianie/)).not.toBeInTheDocument()
  })
})
