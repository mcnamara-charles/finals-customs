import { useEffect, useMemo, useState } from 'react'

import { Link, Navigate, useLocation } from 'react-router-dom'

import { useAuth } from '../auth/authContext'

import {
  clearAuthEmailHint,
  getAuthEmailHint,
  resendSignupConfirmation
} from '../services/authService'

import { supabase } from '../lib/supabaseClient'



const POLL_MS = 4000



export function CheckEmailPage() {

  const { session, authReady, refreshAuth } = useAuth()

  const location = useLocation()

  const from = location.state?.from

  const email = useMemo(() => {
    const fromState = location.state?.email
    const fromQuery = new URLSearchParams(location.search).get('email') || ''
    return (fromState || fromQuery || getAuthEmailHint() || '').trim()
  }, [location.state?.email, location.search])

  const [message, setMessage] = useState('')

  const [error, setError] = useState('')

  const [busy, setBusy] = useState(false)



  useEffect(() => {

    if (!authReady || session || !email || !supabase) return

    refreshAuth()

    const id = window.setInterval(() => {

      refreshAuth()

    }, POLL_MS)

    const onVisibility = () => {

      if (document.visibilityState === 'visible') refreshAuth()

    }

    document.addEventListener('visibilitychange', onVisibility)

    return () => {

      window.clearInterval(id)

      document.removeEventListener('visibilitychange', onVisibility)

    }

  }, [authReady, session, email, refreshAuth])

  useEffect(() => {
    if (authReady && session) clearAuthEmailHint()
  }, [authReady, session])

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



  const handleResend = async () => {

    if (!supabase) {

      setError('Supabase is not configured.')

      return

    }

    setError('')

    setMessage('')

    if (!email) {

      setError('Return to sign in and try again.')

      return

    }

    setBusy(true)

    try {

      await resendSignupConfirmation(email)

      setMessage('Confirmation email sent. Check your inbox and spam folder.')

    } catch (err) {

      setError(err.message || 'Could not resend email.')

    } finally {

      setBusy(false)

    }

  }



  return (

    <div className="access-gate-page">

      <div className="access-gate-card access-gate-card-wide">

        <h1 className="access-gate-title">The Finals Customs</h1>

        <p className="access-gate-help">

          Check your email for a confirmation link. After you confirm, you can sign in. This page will redirect when

          your session is ready. If the link opens a new tab and you still see this screen, try signing in — your session

          may already be active there.

        </p>

        {email ? (

          <p className="access-gate-help">

            We sent a link to <strong>{email}</strong>.

          </p>

        ) : (

          <p className="access-modal-error">No email on file. Use sign in from the login page to continue.</p>

        )}

        {error && <p className="access-modal-error">{error}</p>}

        {message && <p className="access-gate-help">{message}</p>}

        <div className="access-modal-actions access-auth-actions">

          <button

            className="randomize-btn"

            type="button"

            onClick={handleResend}

            disabled={busy || !email}

          >

            {busy ? 'Sending…' : 'Resend confirmation email'}

          </button>

          <Link

            to="/login"

            state={{

              ...(email ? { email } : {}),

              ...(from ? { from } : {})

            }}

            className="access-mode-toggle-btn"

            style={{ textAlign: 'center' }}

          >

            Back to sign in

          </Link>

        </div>

      </div>

    </div>

  )

}

