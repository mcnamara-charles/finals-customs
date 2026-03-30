import { mapAuthError } from '../auth/authErrors'
import { signInWithDiscord } from '../services/authService'
import { supabase } from '../lib/supabaseClient'

function DiscordMark() {
  return (
    <svg className="access-oauth-btn__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
      />
    </svg>
  )
}

function GoogleMark() {
  return (
    <svg
      className="access-oauth-btn__mark"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 533.5 544.3"
      shapeRendering="geometricPrecision"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M533.5 278.4c0-18.5-1.7-36.3-4.8-53.4H272v101h147.1c-6.3 34-25.2 62.7-53.8 82v67h86.9c50.8-46.8 80.3-115.9 80.3-196.6z"
      />
      <path
        fill="#34A853"
        d="M272 544.3c72.6 0 133.6-24 178.1-65.3l-86.9-67c-24.1 16.2-55 25.7-91.2 25.7-69.9 0-129.3-47.2-150.5-110.7H32.1v69.6C76.3 486.6 167.7 544.3 272 544.3z"
      />
      <path
        fill="#4A90E2"
        d="M121.5 326.9c-5.5-16.2-8.7-33.5-8.7-51.3s3.2-35.1 8.7-51.3v-69.6H32.1C11.6 185.4 0 229.4 0 275.6s11.6 90.2 32.1 121.9l89.4-70.6z"
      />
      <path
        fill="#FBBC05"
        d="M272 107.7c39.5 0 75 13.6 102.8 40.3l77.2-77.2C404.9 26.6 344.9 0 272 0 167.7 0 76.3 57.7 32.1 153.1l89.4 69.6C142.7 154.9 202.1 107.7 272 107.7z"
      />
    </svg>
  )
}

/**
 * @param {{
 *   setError: (msg: string) => void,
 *   setBusy: (busy: boolean) => void,
 *   busy: boolean,
 *   groupLabel?: string
 * }} props
 */
export function AuthOAuthButtons({ setError, setBusy, busy, groupLabel = 'Social sign-in' }) {
  const handleDiscord = async () => {
    if (!supabase) {
      setError('Supabase is not configured (URL / anon key).')
      return
    }
    setError('')
    setBusy(true)
    try {
      await signInWithDiscord()
    } catch (err) {
      setError(mapAuthError(err).message)
      setBusy(false)
    }
  }

  return (
    <>
      <div className="access-oauth-row" role="group" aria-label={groupLabel}>
        <button
          type="button"
          className="access-oauth-btn access-oauth-btn--discord"
          onClick={handleDiscord}
          disabled={busy}
        >
          <span className="access-oauth-btn__inner">
            <DiscordMark />
            <span className="access-oauth-btn__label">Discord</span>
          </span>
        </button>
        <button
          type="button"
          className="access-oauth-btn access-oauth-btn--google"
          disabled={true}
          aria-disabled="true"
        >
          <span className="access-oauth-btn__inner">
            <GoogleMark />
            <span className="access-oauth-btn__label">Google</span>
          </span>
        </button>
      </div>
      <p className="access-gate-help access-oauth-email-hint">Or with email</p>
    </>
  )
}
