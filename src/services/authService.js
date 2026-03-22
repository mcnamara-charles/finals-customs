import { supabase } from '../lib/supabaseClient'

/**
 * @param {string} userId
 * @returns {Promise<'view'|'admin'>}
 */
export async function fetchUserRole(userId) {
  if (!supabase || !userId) return 'view'

  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (data?.role === 'admin' || data?.role === 'view') return data.role
  return 'view'
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

export async function signUpWithEmail(email, password) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}
