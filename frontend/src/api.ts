import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// ─── Scores ────────────────────────────────────────────────────────────────

export interface Movie {
  title: string
  category: string | null
  season: number
  average: number | null
  scores: Record<string, number>
}

export interface PersonStat {
  name: string
  watched: number
  average: number | null
  color: string
  nights_ago?: number | null
}

export const getMovies = () => api.get<Movie[]>('/scores/movies').then(r => r.data)
export const getPeople = () => api.get<string[]>('/scores/people').then(r => r.data)
export const getStats = () => api.get<PersonStat[]>('/scores/stats').then(r => r.data)

export interface SessionPayload {
  movies: string[]
  category?: string
  present_people: string[]
  scores: Record<string, Record<string, number | null>>
}
export const submitSession = (payload: SessionPayload, token?: string) =>
  api.post('/scores/session', payload, token ? { headers: { authorization: token } } : undefined)

export interface NightMovie {
  title: string
  average: number | null
  scores?: Record<string, number>
  row_num?: number
}

export interface NightSummary {
  name: string
  season: number
  movie_count: number
  movies: NightMovie[]
  host?: string
}

export const getNights = () => api.get<NightSummary[]>('/scores/nights').then(r => r.data)
export const getLastNightPeople = () => api.get<string[]>('/scores/last-night-people').then(r => r.data)

// ─── Wheel ─────────────────────────────────────────────────────────────────

export interface WheelEntry {
  key: string
  name: string
  categories: string[]
  count: number
  weight: number
  probability: number
  color: string
}

export interface HistoryEntry {
  person: string
  category: string
  row_index: number
}

export interface PersonMovie {
  title: string
  category: string | null
  season: number
  average: number | null
  score: number
  all_scores?: Record<string, number>
}

export interface NextCategory {
  category: string
  person: string
}

export interface ForcedSpin {
  person_key: string
  category: string
}

export interface WheelData {
  entries: WheelEntry[]
  history: HistoryEntry[]
  next_category: NextCategory | null
  forced_spin: ForcedSpin | null
}

export const getWheelData = () => api.get<WheelData>('/wheel/data').then(r => r.data)
export const getNextCategory = () =>
  api.get<NextCategory | null>('/wheel/next-category').then(r => r.data)
export const getLastSpin = () =>
  api.get<{ spin: HistoryEntry | null }>('/wheel/last-spin').then(r => r.data)
export const getNextNightDate = () =>
  api.get<{ date: string | null; time: string | null }>('/wheel/next-night-date').then(r => r.data)
export const addCategories = (categories: Record<string, string[]>) =>
  api.post('/wheel/categories', { categories })
export const simulateSpins = (rounds = 20) =>
  api.get<{ picks: { person: string; category: string }[] }>(`/wheel/simulate?rounds=${rounds}`).then(r => r.data)
export interface AddPersonResult {
  ok: boolean
  created_scores: boolean
  created_wheel: boolean
  color: string
}
export const addPerson = (name: string) =>
  api.post<AddPersonResult>('/wheel/person', { name }).then(r => r.data)

export interface WheelCandidate {
  name: string
  hidden: boolean
}

export const getWheelCandidates = () =>
  api.get<WheelCandidate[]>('/wheel/candidates').then(r => r.data)

export const resurfacePerson = (name: string) =>
  api.post('/wheel/resurface', { name })
export const recordSpin = (person_key: string, category: string) =>
  api.post('/wheel/spin', { person_key, category })

// ─── Admin ──────────────────────────────────────────────────────────────────

export interface AdminPerson {
  name: string
  hidden: boolean
}

export const getPersonData = (name: string) =>
  api.get<{ name: string; movies: PersonMovie[]; color: string }>(`/scores/person/${encodeURIComponent(name)}`).then(r => r.data)

export const setPersonColor = (name: string, color: string) =>
  api.put(`/scores/person/${encodeURIComponent(name)}/color`, { color })

export const adminLogin = (password: string) =>
  api.post<{ token: string }>('/admin/login', { password }).then(r => r.data)

export const adminLogout = (token: string) =>
  api.post('/admin/logout', {}, { headers: { authorization: token } })

export const adminGetPeople = (token: string) =>
  api.get<AdminPerson[]>('/admin/people', { headers: { authorization: token } }).then(r => r.data)

export const adminAddPerson = (name: string, token: string) =>
  api.post('/admin/people', { name }, { headers: { authorization: token } })

export const adminHidePerson = (name: string, token: string) =>
  api.put('/admin/people/hide', { name }, { headers: { authorization: token } })

export const adminShowPerson = (name: string, token: string) =>
  api.put('/admin/people/show', { name }, { headers: { authorization: token } })

export const adminDeleteCategory = (person_key: string, category: string, token: string) =>
  api.delete('/admin/wheel/category', { data: { person_key, category }, headers: { authorization: token } })

export const adminDeleteHistoryEntry = (row_index: number, token: string) =>
  api.delete('/admin/wheel/history', { data: { row_index }, headers: { authorization: token } })

export const adminEditHistoryEntry = (row_index: number, person: string, category: string, token: string) =>
  api.put('/admin/wheel/history', { row_index, person, category }, { headers: { authorization: token } })

export const adminAddHistoryEntry = (person: string, category: string, token: string) =>
  api.post('/admin/wheel/history', { person, category }, { headers: { authorization: token } })

export const adminReorderHistory = (row_indices: number[], token: string) =>
  api.put('/admin/wheel/history/reorder', { row_indices }, { headers: { authorization: token } })

export const adminSetNextNightDate = (date: string | null, time: string | null, token: string) =>
  api.put('/admin/next-night-date', { date, time }, { headers: { authorization: token } })

export const adminRenamePerson = (old_name: string, new_name: string, token: string) =>
  api.put('/admin/people/rename', { old_name, new_name }, { headers: { authorization: token } })

export const adminEditScore = (season: number, row_num: number, person: string, score: number | null, token: string) =>
  api.put('/admin/scores/edit', { season, row_num, person, score }, { headers: { authorization: token } })

export const adminDeleteNight = (season: number, night_name: string, token: string) =>
  api.delete('/admin/scores/night', { data: { season, night_name }, headers: { authorization: token } })

export const adminDeleteMovieRow = (season: number, row_num: number, token: string) =>
  api.delete('/admin/scores/movie', { data: { season, row_num }, headers: { authorization: token } })

export const adminSetNextCategory = (person_key: string, category: string, token: string) =>
  api.put('/admin/next-category', { person_key, category }, { headers: { authorization: token } })

export const adminClearNextCategory = (token: string) =>
  api.delete('/admin/next-category', { headers: { authorization: token } })

export const deleteLastSpin = () =>
  api.delete<{
    ok: boolean
    removed: { person: string; category: string }
    /** False when the category was still on the wheel and needed no restoring. */
    category_restored: boolean
  }>('/wheel/last-spin').then(r => r.data)

export const getSeasonPeople = (season: number) =>
  api.get<string[]>(`/scores/season-people/${season}`).then(r => r.data)

export interface AwardEntry {
  name: string
  avg: number
  std_dev: number
  mae: number
  watched: number
}

export interface Awards {
  harshest?: AwardEntry
  generous?: AwardEntry
  controversial?: AwardEntry
  aligned?: AwardEntry
  min_movies?: number
  last_n?: number
}

export const getAwards = (minMovies = 10) =>
  api.get<Awards>('/scores/awards', { params: { min_movies: minMovies } }).then(r => r.data)

export interface AttendanceNight { index: number; name: string; season: number }
export interface AttendancePerson { name: string; color: string; attendance: boolean[] }
export interface AttendanceData { nights: AttendanceNight[]; people: AttendancePerson[] }
export const getAttendance = () => api.get<AttendanceData>('/scores/attendance').then(r => r.data)
