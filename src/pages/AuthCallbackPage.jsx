import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  clearAuthEmailHint,
  completeAuthRedirect,
  getEmailForAuthHandoff
} from '../services/authService'
import { FullPageLoading } from '../components/FullPageLoading'

export function AuthCallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const emailHandoff = useMemo(() => getEmailForAuthHandoff(), [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { session, error: err } = await completeAuthRedirect()
      if (cancelled) return
      if (err) {
        setError(err.message || 'Could not complete sign-in.')
        return
      }
      if (session) {
        clearAuthEmailHint()
        navigate('/', { replace: true })
        return
      }
      setError('No active session. Try signing in, or request a new confirmation email.')
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (error) {
    return (
      <div className="access-gate-page">
        <div className="access-gate-card access-gate-card-wide">
          <h1 className="access-gate-title">The Finals Customs</h1>
          <p className="access-modal-error" role="alert">{error}</p>
          <div className="access-modal-actions access-auth-actions">
            <Link
              to="/login"
              state={emailHandoff ? { email: emailHandoff } : undefined}
              className="randomize-btn"
              style={{ textAlign: 'center' }}
            >
              Sign in
            </Link>
            <Link
              to="/check-email"
              state={emailHandoff ? { email: emailHandoff } : undefined}
              className="access-mode-toggle-btn"
              style={{ textAlign: 'center' }}
            >
              Resend confirmation
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return <FullPageLoading label="Completing sign in" />
}
