import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/authContext'
import { clearAuthEmailHint, setAuthEmailHint, signUpWithEmail } from '../services/authService'
import { supabase } from '../lib/supabaseClient'

export function SignupPage() {
  const { session, authReady } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const from = location.state?.from
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordRepeat, setPasswordRepeat] = useState('')
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

  const handleSubmit = async () => {
    if (!supabase) {
      setError('Supabase is not configured (URL / anon key).')
      return
    }
    setError('')
    const trimmedEmail = email.trim()
    const fn = firstName.trim()
    const ln = lastName.trim()
    if (!trimmedEmail || !password) {
      setError('Enter email and password.')
      return
    }
    if (!fn || !ln) {
      setError('Enter first and last name.')
      return
    }
    if (password !== passwordRepeat) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setBusy(true)
    try {
      const { session: newSession } = await signUpWithEmail(trimmedEmail, password, {
        firstName,
        lastName
      })
      setPassword('')
      setPasswordRepeat('')
      if (!newSession) {
        setAuthEmailHint(trimmedEmail)
        navigate('/check-email', {
          replace: true,
          state: { email: trimmedEmail, ...(from ? { from } : {}) }
        })
        return
      }
      clearAuthEmailHint()
      const to = from ? `${from.pathname}${from.search || ''}` : '/'
      navigate(to, { replace: true })
    } catch (err) {
      setError(err.message || 'Sign up failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="access-gate-page">
      <div className="access-gate-card access-gate-card-wide">
        <h1 className="access-gate-title">The Finals Customs</h1>
        <p className="access-gate-help">
          Create an account. You will join your first group from the dashboard after sign-in.
        </p>
        <input
          type="text"
          value={firstName}
          onChange={(e) => {
            setFirstName(e.target.value)
            if (error) setError('')
          }}
          placeholder="First name"
          className="access-auth-input"
          autoComplete="given-name"
          autoFocus
        />
        <input
          type="text"
          value={lastName}
          onChange={(e) => {
            setLastName(e.target.value)
            if (error) setError('')
          }}
          placeholder="Last name"
          className="access-auth-input"
          autoComplete="family-name"
        />
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
          autoComplete="new-password"
        />
        <input
          type="password"
          value={passwordRepeat}
          onChange={(e) => {
            setPasswordRepeat(e.target.value)
            if (error) setError('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSubmit()
            }
          }}
          placeholder="Repeat password"
          className="access-auth-input access-auth-password"
          autoComplete="new-password"
        />
        {error && <p className="access-modal-error">{error}</p>}
        <div className="access-modal-actions access-auth-actions">
          <button className="randomize-btn" type="button" onClick={handleSubmit} disabled={busy}>
            Sign up
          </button>
          <Link
            to="/login"
            state={from ? { from } : undefined}
            className="access-mode-toggle-btn"
            style={{ textAlign: 'center' }}
          >
            Have an account? Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
