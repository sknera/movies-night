import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CasinoWheel from '../CasinoWheel'

describe('CasinoWheel completion', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Model a background tab: animation frames never arrive.
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reveals the saved result exactly once even without animation frames', () => {
    const done = vi.fn()
    render(<CasinoWheel items={['Kosmos', 'Anime']} spinning targetIndex={1} onAnimationEnd={done} />)
    act(() => vi.advanceTimersByTime(7100))
    expect(done).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(20000))
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('does not restart the timer when its parent supplies a new callback', () => {
    const first = vi.fn(), latest = vi.fn()
    const view = render(<CasinoWheel items={['Kosmos']} spinning targetIndex={0} onAnimationEnd={first} />)
    act(() => vi.advanceTimersByTime(4000))
    view.rerender(<CasinoWheel items={['Kosmos']} spinning targetIndex={0} onAnimationEnd={latest} />)
    act(() => vi.advanceTimersByTime(3100))
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)
  })

  it('cancels completion after leaving the page', () => {
    const done = vi.fn()
    const view = render(<CasinoWheel items={['Kosmos']} spinning targetIndex={0} onAnimationEnd={done} />)
    view.unmount()
    act(() => vi.advanceTimersByTime(10000))
    expect(done).not.toHaveBeenCalled()
  })
})
