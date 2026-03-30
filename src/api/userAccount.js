import { supabase } from './client.js'
import { getAuthCallbackUrl, normalizeUsernameForSignup } from './auth.js'

const USERNAME_MAX_LEN = 40

/**
 * @param {string} raw
 * @returns {{ ok: true, value: string } | { ok: false, message: string }}
 */
export function validateUsernameForUpdate(raw) {
  const value = normalizeUsernameForSignup(raw)
  if (!value) {
    return { ok: false, message: 'Enter a username (letters, numbers, . _ - only).' }
  }
  if (value.length > USERNAME_MAX_LEN) {
    return { ok: false, message: `Username must be at most ${USERNAME_MAX_LEN} characters.` }
  }
  return { ok: true, value }
}

/**
 * @param {string} newEmail
 */
export async function updateAccountEmail(newEmail) {
  if (!supabase) throw new Error('Supabase is not configured')
  const email = newEmail.trim()
  if (!email) throw new Error('Enter an email address.')
  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: getAuthCallbackUrl() })
  if (error) throw error
}

/**
 * @param {string} newPassword
 */
export async function updateAccountPassword(newPassword) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!newPassword || newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.')
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

/**
 * Updates `profiles.username` and `profiles.display_name`, then auth `user_metadata.username`.
 * @param {string} userId
 * @param {string} normalizedUsername from {@link validateUsernameForUpdate}
 */
export async function updateUsernameEverywhere(userId, normalizedUsername) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data: currentProfile, error: currentProfileError } = await supabase
    .from('profiles')
    .select('username, display_name')
    .eq('user_id', userId)
    .maybeSingle()

  if (currentProfileError) throw currentProfileError

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      username: normalizedUsername,
      display_name: normalizedUsername,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)

  if (profileError) {
    const code = String(profileError.code || '')
    const msg = String(profileError.message || '')
    if (code === '23505' || /duplicate key|unique constraint/i.test(msg)) {
      throw new Error('That username is already taken.')
    }
    throw profileError
  }

  const { error: authError } = await supabase.auth.updateUser({
    data: { username: normalizedUsername }
  })
  if (authError) {
    const rollbackUsername = currentProfile?.username
    const rollbackDisplayName = currentProfile?.display_name
    let rollbackError = null
    if (currentProfile) {
      const { error } = await supabase
        .from('profiles')
        .update({
          username: rollbackUsername,
          display_name: rollbackDisplayName,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
      rollbackError = error
    }
    if (rollbackError) {
      const authMessage = authError.message || 'Could not update auth metadata.'
      const rollbackMessage = rollbackError.message || 'Rollback failed.'
      throw new Error(`${authMessage} (Rollback error: ${rollbackMessage})`)
    }
    throw authError
  }
}
