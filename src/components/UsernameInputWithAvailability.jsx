import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faCircleXmark, faSpinner, faUser } from '@fortawesome/free-solid-svg-icons'
import { normalizeUsernameForSignup } from '../api/auth.js'
import { useDebouncedUsernameAvailability } from '../hooks/useDebouncedUsernameAvailability.js'

const FA_ICON_CLASS = 'app-fa-icon'

/**
 * @param {{
 *   id: string,
 *   value: string,
 *   onChange: (e: import('react').ChangeEvent<HTMLInputElement>) => void,
 *   disabled?: boolean,
 *   usernameCheck: 'idle' | 'debouncing' | 'checking' | 'available' | 'taken' | 'error',
 *   inputClassName?: string,
 *   autoFocus?: boolean,
 *   placeholder?: string
 * }} props
 */
export function UsernameInputWithAvailabilityView({
  id,
  value,
  onChange,
  disabled,
  usernameCheck,
  inputClassName = 'access-auth-input signup-page__username-input',
  autoFocus,
  placeholder = 'Username'
}) {
  const normalizedUsername = normalizeUsernameForSignup(value)
  const showUsernameStatusIcon = Boolean(normalizedUsername)
  const usernameIconIsBusy = usernameCheck === 'debouncing' || usernameCheck === 'checking'
  const usernameIconIsAvailable = usernameCheck === 'available'
  const usernameIconIsUnavailable = usernameCheck === 'taken' || usernameCheck === 'error'
  const usernameStatusIcon = usernameIconIsBusy
    ? faSpinner
    : usernameIconIsAvailable
      ? faCircleCheck
      : usernameIconIsUnavailable
        ? faCircleXmark
        : null

  return (
    <div className="signup-page__field">
      <label htmlFor={id} className="visually-hidden">
        Username
      </label>
      <span className="signup-page__input-affix" aria-hidden="true">
        <FontAwesomeIcon icon={faUser} className={FA_ICON_CLASS} />
      </span>
      <input
        id={id}
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={inputClassName}
        autoComplete="username"
        autoFocus={autoFocus}
        disabled={disabled}
      />
      {showUsernameStatusIcon && usernameStatusIcon ? (
        <span
          className={`signup-page__username-status-icon${
            usernameIconIsAvailable
              ? ' signup-page__username-status-icon--ok'
              : usernameIconIsUnavailable
                ? ' signup-page__username-status-icon--warn'
                : ''
          }`}
          aria-hidden="true"
        >
          <FontAwesomeIcon
            icon={usernameStatusIcon}
            className={FA_ICON_CLASS}
            spin={usernameIconIsBusy}
          />
        </span>
      ) : null}
    </div>
  )
}

/**
 * @param {{
 *   id: string,
 *   value: string,
 *   onChange: (e: import('react').ChangeEvent<HTMLInputElement>) => void,
 *   disabled?: boolean,
 *   excludeUserId?: string | null,
 *   inputClassName?: string,
 *   autoFocus?: boolean,
 *   placeholder?: string
 * }} props
 */
export function UsernameInputWithAvailability({
  id,
  value,
  onChange,
  disabled,
  excludeUserId,
  inputClassName,
  autoFocus,
  placeholder
}) {
  const { usernameCheck } = useDebouncedUsernameAvailability(value, { excludeUserId })
  return (
    <UsernameInputWithAvailabilityView
      id={id}
      value={value}
      onChange={onChange}
      disabled={disabled}
      usernameCheck={usernameCheck}
      inputClassName={inputClassName}
      autoFocus={autoFocus}
      placeholder={placeholder}
    />
  )
}
