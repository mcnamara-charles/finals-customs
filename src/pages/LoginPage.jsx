import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleExclamation,
  faEnvelope,
  faRightToBracket,
  faUserPlus
} from '@fortawesome/free-solid-svg-icons'
import { useAuth } from '../auth/authContext'
import { mapAuthError } from '../auth/authErrors'
import {
  clearAuthEmailHint,
  getAuthEmailHint,
  setAuthEmailHint,
  signInWithEmail
} from '../services/authService'
import { supabase } from '../lib/supabaseClient'
import { AuthOAuthButtons } from '../components/AuthOAuthButtons'
import { AuthPasswordField } from '../components/AuthPasswordField'
import { FullPageLoading } from '../components/FullPageLoading'

const FA_ICON_CLASS = 'app-fa-icon'

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
    return <FullPageLoading label="Loading session" />
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
    if (busy) return
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
    <div className="access-gate-page login-page">
      <div className="access-gate-card access-gate-card-wide login-page__card">
        <header className="login-page__brand">
          <h1 className="access-gate-title login-page__title">The Finals Customs</h1>
          <p className="access-gate-help login-page__lead">Sign in with Discord, Google (coming soon), or email.</p>
        </header>

        <AuthOAuthButtons
          setError={setError}
          setBusy={setBusy}
          busy={busy}
          groupLabel="Social sign-in"
        />

        <form
          className="login-page__form"
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
        >
          <div className="login-page__field">
            <label htmlFor="login-email" className="visually-hidden">
              Email
            </label>
            <span className="login-page__input-affix" aria-hidden="true">
              <FontAwesomeIcon icon={faEnvelope} className={FA_ICON_CLASS} />
            </span>
            <input
              id="login-email"
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
              disabled={busy}
            />
          </div>

          <AuthPasswordField
            id="login-password"
            namePrefix="login-page"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (error) setError('')
            }}
            autoComplete="current-password"
            disabled={busy}
          />

          <button
            className="login-page__submit"
            type="submit"
            disabled={busy}
            aria-busy={busy}
          >
            <span>{busy ? 'Signing in…' : 'Sign in'}</span>
            <FontAwesomeIcon icon={faRightToBracket} className={FA_ICON_CLASS} aria-hidden />
          </button>
        </form>

        {error && (
          <p className="access-modal-error login-page__error" role="alert">
            <FontAwesomeIcon icon={faCircleExclamation} className={FA_ICON_CLASS} aria-hidden />
            <span>{error}</span>
          </p>
        )}

        <div className="access-modal-actions access-auth-actions login-page__actions">
          <div className="login-page__footer-links">
            <Link
              to="/signup"
              state={from ? { from } : undefined}
              className="access-mode-toggle-btn login-page__footer-link"
            >
              <FontAwesomeIcon icon={faUserPlus} className={FA_ICON_CLASS} aria-hidden />
              <span>Need an account? Sign up</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
