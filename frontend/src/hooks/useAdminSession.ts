import { useSyncExternalStore } from 'react'
import { adminGetPeople } from '../api'

let token: string | null = null
let revision = 0
const listeners = new Set<() => void>()

export function setAdminToken(value: string | null) {
  revision++
  token = value
  if (value) sessionStorage.setItem('adminToken', value)
  else sessionStorage.removeItem('adminToken')
  listeners.forEach(listener => listener())
}

async function verify() {
  const saved = sessionStorage.getItem('adminToken')
  const current = ++revision
  // Disable controls while checking a saved session, including after window focus.
  token = null
  listeners.forEach(listener => listener())
  if (!saved) return
  try {
    await adminGetPeople(saved)
    if (current === revision) setAdminToken(saved)
  } catch {
    if (current === revision) setAdminToken(null)
  }
}

function expired(event: Event) {
  const rejectedToken = (event as CustomEvent<string>).detail
  if (rejectedToken === sessionStorage.getItem('adminToken')) setAdminToken(null)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    window.addEventListener('focus', verify)
    window.addEventListener('admin-session-expired', expired)
    void verify()
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      revision++
      token = null
      window.removeEventListener('focus', verify)
      window.removeEventListener('admin-session-expired', expired)
    }
  }
}

export function useAdminSession() {
  return useSyncExternalStore(subscribe, () => token, () => null)
}
