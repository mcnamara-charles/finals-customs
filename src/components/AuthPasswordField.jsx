import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEye, faEyeSlash, faLock } from '@fortawesome/free-solid-svg-icons'

const FA_ICON_CLASS = 'app-fa-icon'

/** Password field with show/hide toggle; use only inside `.login-page` or `.signup-page`. */
export function AuthPasswordField({
  id,
  value,
  onChange,
  disabled,
  autoComplete,
  namePrefix,
  onKeyDown
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div className={`${namePrefix}__field`}>
      <label htmlFor={id} className="visually-hidden">
        Password
      </label>
      <span className={`${namePrefix}__input-affix`} aria-hidden="true">
        <FontAwesomeIcon icon={faLock} className={FA_ICON_CLASS} />
      </span>
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Password"
        className={`access-auth-input access-auth-password ${namePrefix}__password-input`}
        autoComplete={autoComplete}
        disabled={disabled}
      />
      <button
        type="button"
        className={`${namePrefix}__password-toggle`}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        disabled={disabled}
      >
        <FontAwesomeIcon icon={visible ? faEyeSlash : faEye} className={FA_ICON_CLASS} aria-hidden />
      </button>
    </div>
  )
}
