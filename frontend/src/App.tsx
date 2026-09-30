import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import ScoringFlow from './pages/scoring/ScoringFlow'
import WheelPage from './pages/wheel/WheelPage'
import AdminPanel from './pages/admin/AdminPanel'
import StatsPage from './pages/stats/StatsPage'
import HistoryPage from './pages/history/HistoryPage'
import AttendancePage from './pages/attendance/AttendancePage'

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/scoring" element={<ScoringFlow />} />
          <Route path="/wheel" element={<WheelPage />} />
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/attendance" element={<AttendancePage />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
