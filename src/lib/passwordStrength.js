/**
 * Client-only heuristic for signup password feedback (not a security guarantee).
 * @param {string} password
 * @returns {{ tier: 'none' | 'weak' | 'okay' | 'strong', fillPct: number }}
 */
export function getSignupPasswordStrength(password) {
  const p = String(password ?? '')
  if (!p) {
    return { tier: 'none', fillPct: 0 }
  }

  const len = p.length
  const hasLower = /[a-z]/.test(p)
  const hasUpper = /[A-Z]/.test(p)
  const hasDigit = /\d/.test(p)
  const hasSpecial = /[^a-zA-Z0-9]/.test(p)
  const variety = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length

  let tier = 'weak'
  if (len < 8) {
    tier = 'weak'
  } else if (variety >= 3 && len >= 12) {
    tier = 'strong'
  } else if (variety >= 2) {
    tier = 'okay'
  } else {
    tier = 'weak'
  }

  const fillPct =
    tier === 'weak'
      ? Math.min(33, Math.max(8, (len / 8) * 33))
      : tier === 'okay'
        ? 66
        : 100

  return { tier, fillPct }
}
