export const APP_THEME_STORAGE_KEY = 'finals_customs_app_theme'

/** @typedef {'dark' | 'light' | 'system'} AppTheme */

/** @returns {AppTheme} */
export function readStoredAppTheme() {
  if (typeof window === 'undefined') return 'system'
  try {
    const raw = window.localStorage.getItem(APP_THEME_STORAGE_KEY)
    if (raw === 'dark' || raw === 'light' || raw === 'system') return raw
  } catch {
    /* ignore */
  }
  return 'system'
}

/** @param {AppTheme} theme */
export function persistAppTheme(theme) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme)
  } catch {
    /* ignore */
  }
}

/** @param {AppTheme} theme */
export function applyAppTheme(theme) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.appTheme = theme
}
