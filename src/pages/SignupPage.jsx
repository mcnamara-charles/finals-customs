import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleExclamation,
  faEnvelope,
  faRightToBracket,
  faUser,
  faUserPlus
} from '@fortawesome/free-solid-svg-icons'
import { useAuth } from '../auth/authContext'
import {
  clearAuthEmailHint,
  normalizeUsernameForSignup,
  setAuthEmailHint,
  signUpWithEmail
} from '../services/authService'
import { normalizeAuthErrorMessage } from '../auth/authErrors'
import { supabase } from '../lib/supabaseClient'
import { AuthOAuthButtons } from '../components/AuthOAuthButtons'
import { AuthPasswordField } from '../components/AuthPasswordField'
import { FullPageLoading } from '../components/FullPageLoading'

const FA_ICON_CLASS = 'app-fa-icon'

export function SignupPage() {
  const { session, authReady } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const from = location.state?.from
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
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

  const handleSubmit = async () => {
    if (busy) return
    if (!supabase) {
      setError('Supabase is not configured (URL / anon key).')
      return
    }
    setError('')
    const trimmedEmail = email.trim()
    const normalizedUser = normalizeUsernameForSignup(username)
    if (!trimmedEmail || !password) {
      setError('Enter email and password.')
      return
    }
    if (!normalizedUser) {
      setError('Enter a username (letters, numbers, . _ - only).')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setBusy(true)
    try {
      const { session: newSession } = await signUpWithEmail(trimmedEmail, password, {
        username: normalizedUser
      })
      setPassword('')
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
      console.error('[SignupPage] signUpWithEmail failed', err)
      setError(normalizeAuthErrorMessage(err, 'Sign up failed. Check auth redirect URL settings.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="access-gate-page signup-page">
      <div className="access-gate-card access-gate-card-wide signup-page__card">
        <header className="signup-page__brand">
          <h1 className="access-gate-title signup-page__title">The Finals Customs</h1>
          <p className="access-gate-help signup-page__lead">
            Create an account with Discord, Google (coming soon), or email.
          </p>
        </header>

        <AuthOAuthButtons
          setError={setError}
          setBusy={setBusy}
          busy={busy}
          groupLabel="Social sign-up"
        />

        <form
          className="signup-page__form"
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
        >
          <div className="signup-page__field">
            <label htmlFor="signup-username" className="visually-hidden">
              Username
            </label>
            <span className="signup-page__input-affix" aria-hidden="true">
              <FontAwesomeIcon icon={faUser} className={FA_ICON_CLASS} />
            </span>
            <input
              id="signup-username"
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                if (error) setError('')
              }}
              placeholder="Username"
              className="access-auth-input"
              autoComplete="username"
              autoFocus
              disabled={busy}
            />
          </div>

          <div className="signup-page__field">
            <label htmlFor="signup-email" className="visually-hidden">
              Email
            </label>
            <span className="signup-page__input-affix" aria-hidden="true">
              <FontAwesomeIcon icon={faEnvelope} className={FA_ICON_CLASS} />
            </span>
            <input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (error) setError('')
              }}
              placeholder="Email"
              className="access-auth-input"
              autoComplete="email"
              disabled={busy}
            />
          </div>

          <AuthPasswordField
            id="signup-password"
            namePrefix="signup-page"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (error) setError('')
            }}
            autoComplete="new-password"
            disabled={busy}
          />

          <button
            className="signup-page__submit"
            type="submit"
            disabled={busy}
            aria-busy={busy}
          >
            <span>{busy ? 'Creating account…' : 'Sign up'}</span>
            <FontAwesomeIcon icon={faUserPlus} className={FA_ICON_CLASS} aria-hidden />
          </button>
        </form>

        {error && (
          <p className="access-modal-error signup-page__error" role="alert">
            <FontAwesomeIcon icon={faCircleExclamation} className={FA_ICON_CLASS} aria-hidden />
            <span>{error}</span>
          </p>
        )}

        <div className="access-modal-actions access-auth-actions signup-page__actions">
          <div className="signup-page__footer-links">
            <Link
              to="/login"
              state={from ? { from } : undefined}
              className="access-mode-toggle-btn signup-page__footer-link"
            >
              <FontAwesomeIcon icon={faRightToBracket} className={FA_ICON_CLASS} aria-hidden />
              <span>Have an account? Sign in</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
