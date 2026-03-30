/**
 * @param {import('@supabase/supabase-js').AuthError | Error | null | undefined} err
 */
export function mapAuthError(err) {
  if (!err) return { kind: 'generic', message: 'Authentication failed.' }
  const msg = String(err.message || '')
  const code = 'code' in err ? err.code : ''

  if (
    code === 'email_not_confirmed' ||
    /email not confirmed/i.test(msg) ||
    /confirm your email/i.test(msg)
  ) {
    return {
      kind: 'unconfirmed',
      message:
        'This email is not confirmed yet. Open the link we sent you, then sign in. You can resend the email from the check-email page.'
    }
  }

  return { kind: 'generic', message: msg || 'Authentication failed.' }
}

/**
 * Convert unknown auth errors (including `{}` payloads) into readable text.
 * @param {unknown} err
 * @param {string} fallback
 */
export function normalizeAuthErrorMessage(err, fallback = 'Authentication failed.') {
  if (err == null) return fallback

  if (typeof err === 'string') {
    const trimmed = err.trim()
    if (trimmed && trimmed !== '{}' && trimmed !== '[object Object]') return trimmed
    return fallback
  }

  if (typeof err === 'object') {
    const maybeObj = /** @type {Record<string, unknown>} */ (err)
    const candidates = [
      maybeObj.message,
      maybeObj.error_description,
      maybeObj.error,
      maybeObj.hint,
      maybeObj.details
    ]

    for (const item of candidates) {
      if (typeof item !== 'string') continue
      const trimmed = item.trim()
      if (trimmed && trimmed !== '{}' && trimmed !== '[object Object]') return trimmed
    }

    if (typeof maybeObj.code === 'string' && maybeObj.code.trim()) {
      return `Authentication failed (${maybeObj.code.trim()}).`
    }

    try {
      const serialized = JSON.stringify(maybeObj)
      if (serialized && serialized !== '{}' && serialized !== 'null') return serialized
    } catch {
      // Ignore JSON serialization failures.
    }
  }

  return fallback
}
