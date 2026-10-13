const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export function getErrorMessage(error: unknown, fallback = 'Błąd') {
  if (!isRecord(error) || !isRecord(error.response) || !isRecord(error.response.data)) return fallback
  const detail = error.response.data.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const messages = detail.flatMap(item => isRecord(item) && typeof item.msg === 'string' ? [item.msg] : [])
    if (messages.length) return messages.join('; ')
  }
  return fallback
}
