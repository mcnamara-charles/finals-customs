const INVITE_STORAGE_KEY = 'finals_customs.pending_invite_code'
const INVITE_QUERY_PARAM = 'invite'
const DEFAULT_PROD_APP_URL = 'https://finalscustomsapp.com'

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeInviteCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
}

/**
 * @param {string} [search]
 * @returns {string}
 */
export function readInviteCodeFromSearch(search) {
  const rawSearch =
    typeof search === 'string'
      ? search
      : typeof window !== 'undefined'
        ? window.location.search
        : ''
  const params = new URLSearchParams(rawSearch || '')
  return normalizeInviteCode(params.get(INVITE_QUERY_PARAM))
}

/**
 * @param {unknown} code
 */
export function storePendingInviteCode(code) {
  if (typeof window === 'undefined') return
  const normalized = normalizeInviteCode(code)
  if (!normalized) return
  try {
    window.localStorage.setItem(INVITE_STORAGE_KEY, normalized)
  } catch {
    /* ignore storage errors */
  }
}

/**
 * @returns {string}
 */
export function readStoredPendingInviteCode() {
  if (typeof window === 'undefined') return ''
  try {
    return normalizeInviteCode(window.localStorage.getItem(INVITE_STORAGE_KEY))
  } catch {
    return ''
  }
}

export function clearStoredPendingInviteCode() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(INVITE_STORAGE_KEY)
  } catch {
    /* ignore storage errors */
  }
}

/**
 * @param {string} joinCode
 * @returns {string}
 */
export function buildInviteLink(joinCode) {
  const normalized = normalizeInviteCode(joinCode)
  if (!normalized) return ''
  const configuredBase = String(
    import.meta.env?.VITE_PUBLIC_APP_URL || import.meta.env?.VITE_APP_URL || DEFAULT_PROD_APP_URL
  ).trim()
  let baseOrigin = DEFAULT_PROD_APP_URL
  try {
    const parsed = new URL(configuredBase || DEFAULT_PROD_APP_URL)
    const host = String(parsed.hostname || '').toLowerCase()
    if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
      baseOrigin = parsed.origin
    }
  } catch {
    baseOrigin = DEFAULT_PROD_APP_URL
  }
  const url = new URL(baseOrigin)
  url.searchParams.set(INVITE_QUERY_PARAM, normalized)
  return url.toString()
}
