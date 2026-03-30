import { supabase } from './client.js'

export function getAuthCallbackUrl() {
  if (typeof window === 'undefined') return undefined
  const configuredBase =
    (import.meta.env.VITE_PUBLIC_APP_URL || import.meta.env.VITE_APP_URL || '').trim()
  const fallbackBase = window.location.origin
  try {
    const resolved = new URL(configuredBase || fallbackBase)
    return `${resolved.origin}/auth/callback`
  } catch {
    return `${fallbackBase}/auth/callback`
  }
}

export async function getSession() {
  if (!supabase) return { session: null }
  const {
    data: { session }
  } = await supabase.auth.getSession()
  return { session }
}

/**
 * @param {(event: string, session: import('@supabase/supabase-js').Session | null) => void} callback
 */
export function onAuthStateChange(callback) {
  if (!supabase) {
    return { data: { subscription: { unsubscribe: () => {} } } }
  }
  return supabase.auth.onAuthStateChange(callback)
}

export async function signInWithEmail(email, password) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signInWithDiscord() {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: {
      redirectTo: getAuthCallbackUrl(),
      skipBrowserRedirect: true,
      scopes: 'identify email',
      queryParams: {
        prompt: 'none',
      },
    },
  })
  if (error) throw error
  const url = data?.url
  if (!url) throw new Error('Could not start Discord sign-in.')
  window.location.assign(url)
}

/** @param {string} raw */
export function normalizeUsernameForSignup(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
}

/**
 * @param {string} email
 * @param {string} password
 * @param {{ username: string }} profile
 */
export async function signUpWithEmail(email, password, profile) {
  if (!supabase) throw new Error('Supabase is not configured')
  const username = normalizeUsernameForSignup(profile.username)
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getAuthCallbackUrl(),
      data: {
        username
      }
    }
  })
  if (error) throw error
  return data
}

/**
 * @param {string} email
 */
export async function resendSignupConfirmation(email) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim(),
    options: { emailRedirectTo: getAuthCallbackUrl() }
  })
  if (error) throw error
}

/**
 * Finish email confirmation / OAuth redirect (PKCE code or hash tokens).
 * @returns {Promise<{ session: import('@supabase/supabase-js').Session | null, error: Error | null }>}
 */
export async function completeAuthRedirect() {
  if (!supabase) return { session: null, error: new Error('Supabase is not configured') }
  try {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('code')
    if (code) {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(window.location.href)
      if (exchangeError) return { session: null, error: exchangeError }
    }
    const {
      data: { session },
      error
    } = await supabase.auth.getSession()
    if (error) return { session: null, error }
    return { session, error: null }
  } catch (e) {
    return { session: null, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export async function signOutFromSupabase() {
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
