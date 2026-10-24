import { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import AuthPage from './Authpage'
import Workspace from './Workspace'
import { currentUser, logout } from './store'
import type { User } from './store'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dark, setDark] = useState(() => localStorage.getItem('taskflow.theme') === 'dark')

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('taskflow.theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    let active = true
    currentUser().then(value => { if (active) setUser(value) }).catch(cause => { if (active) setError(cause.message) }).finally(() => { if (active) setLoading(false) })
    const expire = () => setUser(null)
    window.addEventListener('session-expired', expire)
    return () => { active = false; window.removeEventListener('session-expired', expire) }
  }, [])

  async function signOut() { await logout(); setUser(null) }
  if (loading || error) return <div className="boot-screen">
    <div className="brand">
      <span className="brand-mark">t<span />
      </span>taskflow<span className="brand-period">.</span>
    </div>{loading ? <p className="muted">Opening your workspace…</p> : <>
      <p role="alert">{error}</p>
      <button className="button primary" onClick={() => window.location.reload()}>Try again</button>
    </>}</div>
  const theme = { dark, toggleTheme: () => setDark(value => !value) }
  return <HashRouter>
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <AuthPage key="login" mode="login" onAuth={setUser} />} />
      <Route path="/signup" element={user ? <Navigate to="/" replace /> : <AuthPage key="signup" mode="signup" onAuth={setUser} />} />
      <Route path="/*" element={user ? <Workspace key={user.id} user={user} onUserChange={setUser} onLogout={signOut} {...theme} /> : <Navigate to="/login" replace />} />
    </Routes>
  </HashRouter>
}
