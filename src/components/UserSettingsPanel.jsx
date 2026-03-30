import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/authContext'
import { normalizeAuthErrorMessage } from '../auth/authErrors'
import { supabase } from '../lib/supabaseClient'
import {
  updateAccountEmail,
  updateAccountPassword,
  updateUsernameEverywhere,
  validateUsernameForUpdate
} from '../api/userAccount.js'
import { applyAppTheme, persistAppTheme, readStoredAppTheme } from '../theme/appTheme.js'

/**
 * @param {{
 *   initialUsername: string,
 *   currentEmail: string,
 *   userId: string,
 *   onProfileUpdated: () => Promise<void>
 * }} props
 */
export function UserSettingsPanel({ initialUsername, currentEmail, userId, onProfileUpdated }) {
  const { refreshAuth } = useAuth()
  const [themeChoice, setThemeChoice] = useState(() => readStoredAppTheme())
  const [usernameInput, setUsernameInput] = useState(initialUsername)
  const [emailInput, setEmailInput] = useState(currentEmail)
  const [passwordNew, setPasswordNew] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')

  const [usernameBusy, setUsernameBusy] = useState(false)
  const [emailBusy, setEmailBusy] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)

  const [usernameMessage, setUsernameMessage] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')

  const [usernameError, setUsernameError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')

  useEffect(() => {
    setUsernameInput(initialUsername)
    setEmailInput(currentEmail)
    setPasswordNew('')
    setPasswordConfirm('')
    setUsernameMessage('')
    setEmailMessage('')
    setPasswordMessage('')
    setUsernameError('')
    setEmailError('')
    setPasswordError('')
    setThemeChoice(readStoredAppTheme())
  }, [initialUsername, currentEmail, userId])

  const handleThemeChange = useCallback((e) => {
    const v = /** @type {'dark'|'light'|'system'} */ (e.target.value)
    setThemeChoice(v)
    persistAppTheme(v)
    applyAppTheme(v)
  }, [])

  const handleSaveUsername = useCallback(async () => {
    setUsernameError('')
    setUsernameMessage('')
    if (!supabase) {
      setUsernameError('Supabase is not configured.')
      return
    }
    const parsed = validateUsernameForUpdate(usernameInput)
    if (!parsed.ok) {
      setUsernameError(parsed.message)
      return
    }
    const normalizedInitial = validateUsernameForUpdate(initialUsername)
    const same =
      normalizedInitial.ok && normalizedInitial.value === parsed.value
    if (same) {
      setUsernameMessage('No changes to save.')
      return
    }
    setUsernameBusy(true)
    try {
      await updateUsernameEverywhere(userId, parsed.value)
      await refreshAuth()
      await onProfileUpdated()
      setUsernameMessage('Username updated.')
    } catch (err) {
      console.error('[UserSettings] username update failed', err)
      setUsernameError(normalizeAuthErrorMessage(err, 'Could not update username.'))
    } finally {
      setUsernameBusy(false)
    }
  }, [usernameInput, initialUsername, userId, onProfileUpdated, refreshAuth])

  const handleSaveEmail = useCallback(async () => {
    setEmailError('')
    setEmailMessage('')
    if (!supabase) {
      setEmailError('Supabase is not configured.')
      return
    }
    const next = emailInput.trim()
    if (!next) {
      setEmailError('Enter an email address.')
      return
    }
    if (!next.includes('@')) {
      setEmailError('Enter a valid email address.')
      return
    }
    if (next.toLowerCase() === (currentEmail || '').trim().toLowerCase()) {
      setEmailMessage('That is already your email.')
      return
    }
    setEmailBusy(true)
    try {
      await updateAccountEmail(next)
      await refreshAuth()
      setEmailMessage(
        'Confirmation sent. Check your inbox (and spam). You may need to confirm from both your current and new address, depending on your project settings.'
      )
    } catch (err) {
      console.error('[UserSettings] email update failed', err)
      setEmailError(normalizeAuthErrorMessage(err, 'Could not start email change.'))
    } finally {
      setEmailBusy(false)
    }
  }, [emailInput, currentEmail, refreshAuth])

  const handleSavePassword = useCallback(async () => {
    setPasswordError('')
    setPasswordMessage('')
    if (!supabase) {
      setPasswordError('Supabase is not configured.')
      return
    }
    if (passwordNew.length < 8) {
      setPasswordError('Password must be at least 8 characters.')
      return
    }
    if (passwordNew !== passwordConfirm) {
      setPasswordError('New password and confirmation do not match.')
      return
    }
    setPasswordBusy(true)
    try {
      await updateAccountPassword(passwordNew)
      setPasswordNew('')
      setPasswordConfirm('')
      setPasswordMessage('Password updated.')
    } catch (err) {
      console.error('[UserSettings] password update failed', err)
      setPasswordError(normalizeAuthErrorMessage(err, 'Could not update password.'))
    } finally {
      setPasswordBusy(false)
    }
  }, [passwordNew, passwordConfirm])

  return (
    <div className="user-settings-panel">
      <section className="user-settings-section" aria-labelledby="user-settings-appearance-title">
        <h3 id="user-settings-appearance-title" className="groups-dashboard-settings-title">
          Appearance
        </h3>
        <p className="groups-dashboard-settings-hint user-settings-hint">
          Applies across the app. System follows your device setting.
        </p>
        <label className="user-settings-field-label" htmlFor="user-settings-theme">
          Theme
        </label>
        <select
          id="user-settings-theme"
          className="settings-overrides-select user-settings-select"
          value={themeChoice}
          onChange={handleThemeChange}
        >
          <option value="system">System</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </section>

      <section className="user-settings-section" aria-labelledby="user-settings-username-title">
        <h3 id="user-settings-username-title" className="groups-dashboard-settings-title">
          Username
        </h3>
        <p className="groups-dashboard-settings-hint user-settings-hint">
          Lowercase letters, numbers, and . _ - only. Updates your profile and sign-in metadata.
        </p>
        <label className="user-settings-field-label" htmlFor="user-settings-username-input">
          Username
        </label>
        <input
          id="user-settings-username-input"
          className="access-auth-input user-settings-input"
          type="text"
          autoComplete="username"
          value={usernameInput}
          onChange={(e) => {
            setUsernameInput(e.target.value)
            if (usernameError) setUsernameError('')
            if (usernameMessage) setUsernameMessage('')
          }}
        />
        {usernameError ? (
          <p className="user-settings-error" role="alert">
            {usernameError}
          </p>
        ) : null}
        {usernameMessage ? <p className="user-settings-success">{usernameMessage}</p> : null}
        <div className="user-settings-actions">
          <button
            type="button"
            className="groups-dashboard-join-btn"
            onClick={handleSaveUsername}
            disabled={usernameBusy}
          >
            {usernameBusy ? 'Saving…' : 'Save username'}
          </button>
        </div>
      </section>

      <section className="user-settings-section" aria-labelledby="user-settings-email-title">
        <h3 id="user-settings-email-title" className="groups-dashboard-settings-title">
          Email
        </h3>
        <p className="groups-dashboard-settings-hint user-settings-hint">
          Current: <span className="user-settings-current-value">{currentEmail || '—'}</span>
        </p>
        <label className="user-settings-field-label" htmlFor="user-settings-email-input">
          New email
        </label>
        <input
          id="user-settings-email-input"
          className="access-auth-input user-settings-input"
          type="email"
          autoComplete="email"
          value={emailInput}
          onChange={(e) => {
            setEmailInput(e.target.value)
            if (emailError) setEmailError('')
            if (emailMessage) setEmailMessage('')
          }}
        />
        {emailError ? (
          <p className="user-settings-error" role="alert">
            {emailError}
          </p>
        ) : null}
        {emailMessage ? <p className="user-settings-success">{emailMessage}</p> : null}
        <div className="user-settings-actions">
          <button
            type="button"
            className="groups-dashboard-join-btn"
            onClick={handleSaveEmail}
            disabled={emailBusy}
          >
            {emailBusy ? 'Updating…' : 'Change email'}
          </button>
        </div>
      </section>

      <section className="user-settings-section" aria-labelledby="user-settings-password-title">
        <h3 id="user-settings-password-title" className="groups-dashboard-settings-title">
          Password
        </h3>
        <p className="groups-dashboard-settings-hint user-settings-hint">At least 8 characters.</p>
        <label className="user-settings-field-label" htmlFor="user-settings-password-new">
          New password
        </label>
        <input
          id="user-settings-password-new"
          className="access-auth-input user-settings-input access-auth-password"
          type="password"
          autoComplete="new-password"
          value={passwordNew}
          onChange={(e) => {
            setPasswordNew(e.target.value)
            if (passwordError) setPasswordError('')
            if (passwordMessage) setPasswordMessage('')
          }}
        />
        <label className="user-settings-field-label" htmlFor="user-settings-password-confirm">
          Confirm password
        </label>
        <input
          id="user-settings-password-confirm"
          className="access-auth-input user-settings-input access-auth-password"
          type="password"
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={(e) => {
            setPasswordConfirm(e.target.value)
            if (passwordError) setPasswordError('')
            if (passwordMessage) setPasswordMessage('')
          }}
        />
        {passwordError ? (
          <p className="user-settings-error" role="alert">
            {passwordError}
          </p>
        ) : null}
        {passwordMessage ? <p className="user-settings-success">{passwordMessage}</p> : null}
        <div className="user-settings-actions">
          <button
            type="button"
            className="groups-dashboard-join-btn"
            onClick={handleSavePassword}
            disabled={passwordBusy}
          >
            {passwordBusy ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </section>
    </div>
  )
}
