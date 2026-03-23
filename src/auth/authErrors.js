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
