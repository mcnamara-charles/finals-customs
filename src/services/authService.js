import {
  completeAuthRedirect,
  getSession,
  onAuthStateChange,
  resendSignupConfirmation,
  signInWithEmail,
  signOutFromSupabase,
  signUpWithEmail
} from '../api/auth.js'

const AUTH_EMAIL_HINT_KEY = 'finals_customs_auth_email_hint'

/** Persist email for resend / login when router state is lost (e.g. auth callback error, new tab). */
export function setAuthEmailHint(email) {
  if (typeof window === 'undefined' || email == null) return
  const t = String(email).trim()
  if (!t) return
  try {
    window.localStorage.setItem(AUTH_EMAIL_HINT_KEY, t)
  } catch {
    /* ignore quota / private mode */
  }
}

export function getAuthEmailHint() {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(AUTH_EMAIL_HINT_KEY)?.trim() || ''
  } catch {
    return ''
  }
}

export function clearAuthEmailHint() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(AUTH_EMAIL_HINT_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Best-effort email for links off /auth/callback (query, hash, then stored hint).
 * @returns {string}
 */
export function getEmailForAuthHandoff() {
  if (typeof window === 'undefined') return ''
  try {
    const url = new URL(window.location.href)
    const q = url.searchParams.get('email')
    if (q?.trim()) return q.trim()
    const hash = url.hash.replace(/^#/, '')
    if (hash.includes('=')) {
      const hp = new URLSearchParams(hash)
      const he = hp.get('email')
      if (he?.trim()) return he.trim()
    }
  } catch {
    /* ignore */
  }
  return getAuthEmailHint()
}

export { getSession, onAuthStateChange, signInWithEmail, signUpWithEmail, resendSignupConfirmation, completeAuthRedirect }

export async function signOut() {
  await signOutFromSupabase()
  clearAuthEmailHint()
}
