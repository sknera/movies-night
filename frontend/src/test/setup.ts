import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// Every view transition runs through framer-motion's AnimatePresence in
// `wait` mode, so the incoming screen only mounts once the outgoing one has
// finished exiting. Under jsdom that takes longer than the 1s default.
configure({ asyncUtilTimeout: 5000 })

// This jsdom build does not ship a Storage implementation, and the app treats
// localStorage as optional anyway — give the tests a real one to assert on.
if (!('localStorage' in window) || !window.localStorage) {
  const store = new Map<string, string>()
  const storage: Storage = {
    get length() { return store.size },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
  }
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

// jsdom has no layout, so anything that scrolls an element into view throws.
window.HTMLElement.prototype.scrollIntoView = vi.fn()
