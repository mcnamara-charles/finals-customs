import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/authContext'
import { mapAuthError } from '../auth/authErrors'
import {
  clearAuthEmailHint,
  getAuthEmailHint,
  setAuthEmailHint,
  signInWithEmail
} from '../services/authService'
import { supabase } from '../lib/supabaseClient'

export function LoginPage() {
  const { session, authReady } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const from = location.state?.from
  const [email, setEmail] = useState(() => {
    const q =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('email') || '' : ''
    return (location.state?.email || q || getAuthEmailHint() || '').trim()
  })
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!authReady) {
    return (
      <div className="access-gate-page">
        <div className="access-gate-card">
          <h1 className="access-gate-title">The Finals Customs</h1>
          <p className="access-gate-help">Loading…</p>
        </div>
      </div>
    )
  }

  if (session) {
    const to = from ? `${from.pathname}${from.search || ''}` : '/'
    return <Navigate to={to} replace />
  }

  const goAfterLogin = () => {
    const to = from ? `${from.pathname}${from.search || ''}` : '/'
    navigate(to, { replace: true })
  }

  const handleSubmit = async () => {
    if (!supabase) {
      setError('Supabase is not configured (URL / anon key).')
      return
    }
    setError('')
    const trimmed = email.trim()
    if (!trimmed || !password) {
      setError('Enter email and password.')
      return
    }
    setBusy(true)
    try {
      await signInWithEmail(trimmed, password)
      setPassword('')
      clearAuthEmailHint()
      goAfterLogin()
    } catch (err) {
      const mapped = mapAuthError(err)
      if (mapped.kind === 'unconfirmed') {
        setAuthEmailHint(trimmed)
        navigate('/check-email', {
          replace: true,
          state: { email: trimmed, ...(from ? { from } : {}) }
        })
        return
      }
      setError(mapped.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="access-gate-page">
      <div className="access-gate-card access-gate-card-wide">
        <h1 className="access-gate-title">The Finals Customs</h1>
        <p className="access-gate-help">Sign in with your email.</p>
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (error) setError('')
          }}
          placeholder="Email"
          className="access-auth-input"
          autoComplete="email"
          autoFocus
        />
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (error) setError('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSubmit()
            }
          }}
          placeholder="Password"
          className="access-auth-input access-auth-password"
          autoComplete="current-password"
        />
        {error && <p className="access-modal-error">{error}</p>}
        <div className="access-modal-actions access-auth-actions">
          <button className="randomize-btn" type="button" onClick={handleSubmit} disabled={busy}>
            Sign in
          </button>
          <Link
            to="/signup"
            state={from ? { from } : undefined}
            className="access-mode-toggle-btn"
            style={{ textAlign: 'center' }}
          >
            Need an account? Sign up
          </Link>
          <Link
            to="/check-email"
            state={{ email: email.trim(), ...(from ? { from } : {}) }}
            className="access-mode-toggle-btn"
            style={{ textAlign: 'center' }}
            onClick={() => {
              const t = email.trim()
              if (t) setAuthEmailHint(t)
            }}
          >
            Waiting for confirmation email?
          </Link>
        </div>
      </div>
    </div>
  )
}
