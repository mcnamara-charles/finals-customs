import { useCallback, useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleExclamation } from '@fortawesome/free-solid-svg-icons'
import { supabase } from '../lib/supabaseClient'
import { normalizeUsernameForSignup } from '../api/auth.js'
import {
  markUsernameOnboardingComplete,
  updateUsernameEverywhere,
  validateUsernameForUpdate
} from '../api/userAccount.js'
import { UsernameInputWithAvailabilityView } from '../components/UsernameInputWithAvailability'
import { FullPageLoading } from '../components/FullPageLoading'
import { useDebouncedUsernameAvailability } from '../hooks/useDebouncedUsernameAvailability.js'
import { signOut } from '../services/authService'
import { normalizeAuthErrorMessage } from './authErrors'
import { useAuth } from './authContext'

const FA_ICON_CLASS = 'app-fa-icon'

/**
 * @param {{ userId: string, initialUsername: string, onCompleted: () => void }} props
 */
function DiscordUsernameOnboardingModal({ userId, initialUsername, onCompleted }) {
  const { refreshAuth } = useAuth()
  const [username, setUsername] = useState(initialUsername)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const { usernameCheck } = useDebouncedUsernameAvailability(username, { excludeUserId: userId })

  useEffect(() => {
    setUsername(initialUsername)
  }, [initialUsername])

  const parsed = validateUsernameForUpdate(username)
  const parsedInitial = validateUsernameForUpdate(initialUsername)
  const sameAsInitial =
    parsed.ok && parsedInitial.ok && parsed.value === parsedInitial.value

  const canSave =
    parsed.ok &&
    !busy &&
    usernameCheck !== 'taken' &&
    usernameCheck !== 'error' &&
    (sameAsInitial || usernameCheck === 'available')

  const handleSave = async () => {
    if (!canSave || !supabase) return
    setError('')
    setBusy(true)
    try {
      if (sameAsInitial) {
        await markUsernameOnboardingComplete(userId)
      } else {
        await updateUsernameEverywhere(userId, parsed.value, { markUsernameOnboardingComplete: true })
      }
      await refreshAuth()
      onCompleted()
    } catch (err) {
      console.error('[UsernameOnboarding] save failed', err)
      setError(normalizeAuthErrorMessage(err, 'Could not save username.'))
    } finally {
      setBusy(false)
    }
  }

  const handleSignOut = async () => {
    setBusy(true)
    try {
      await signOut()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="username-onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="username-onboarding-title">
      <div className="access-gate-card access-gate-card-wide username-onboarding-card">
        <header>
          <h1 id="username-onboarding-title" className="access-gate-title username-onboarding-title">
            Choose your username
          </h1>
          <p className="access-gate-help username-onboarding-lead">
            Confirm or change the username for your account. You need a unique handle before using the app.
          </p>
        </header>

        <div className="signup-page__username-block username-onboarding-field-block">
          <UsernameInputWithAvailabilityView
            id="onboarding-username"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              if (error) setError('')
            }}
            disabled={busy}
            usernameCheck={usernameCheck}
            autoFocus
          />
        </div>

        {error ? (
          <p className="access-modal-error username-onboarding-error" role="alert">
            <FontAwesomeIcon icon={faCircleExclamation} className={FA_ICON_CLASS} aria-hidden />
            <span>{error}</span>
          </p>
        ) : null}

        <div className="username-onboarding-actions">
          <button
            type="button"
            className="signup-page__submit username-onboarding-primary"
            onClick={handleSave}
            disabled={!canSave}
            aria-busy={busy}
          >
            {busy ? 'Saving…' : 'Save and continue'}
          </button>
          <button
            type="button"
            className="access-mode-toggle-btn username-onboarding-secondary"
            onClick={handleSignOut}
            disabled={busy}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

/** @param {{ children: import('react').ReactNode }} props */
export function UsernameOnboardingGate({ children }) {
  const { session, authReady, refreshAuth } = useAuth()
  const [phase, setPhase] = useState(/** @type {'loading' | 'app' | 'onboarding'} */ ('loading'))
  const [initialUsername, setInitialUsername] = useState('')

  const sessionUserId = session?.user?.id

  useEffect(() => {
    if (!authReady) return
    if (!sessionUserId || !supabase) {
      setPhase('app')
      return
    }
    let cancelled = false
    setPhase('loading')
    ;(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('username, username_onboarding_completed')
        .eq('user_id', sessionUserId)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        console.error('[UsernameOnboardingGate] profile load failed', error)
        setPhase('app')
        return
      }
      if (!data) {
        setPhase('app')
        return
      }
      if (data.username_onboarding_completed === false) {
        setInitialUsername((data.username || '').trim())
        setPhase('onboarding')
        return
      }
      setPhase('app')
    })()
    return () => {
      cancelled = true
    }
  }, [authReady, sessionUserId])

  const handleCompleted = useCallback(() => {
    setPhase('app')
    void refreshAuth()
  }, [refreshAuth])

  const modalSeedUsername = useMemo(
    () =>
      initialUsername ||
      normalizeUsernameForSignup(session?.user?.user_metadata?.username || ''),
    [initialUsername, session?.user?.user_metadata?.username]
  )

  if (!authReady) {
    return <FullPageLoading label="Loading session" />
  }

  if (!session) {
    return children
  }

  if (phase === 'loading') {
    return <FullPageLoading label="Loading profile" />
  }

  if (phase === 'onboarding' && session.user?.id) {
    return (
      <DiscordUsernameOnboardingModal
        userId={session.user.id}
        initialUsername={modalSeedUsername}
        onCompleted={handleCompleted}
      />
    )
  }

  return children
}
