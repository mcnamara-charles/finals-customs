import { useEffect, useRef, useState } from 'react'
import { checkUsernameAvailability, normalizeUsernameForSignup } from '../api/auth.js'

export const USERNAME_DEBOUNCE_MS = 450

/**
 * @param {string} username raw input
 * @param {{ excludeUserId?: string | null }} [options]
 */
export function useDebouncedUsernameAvailability(username, options = {}) {
  const { excludeUserId = null } = options
  const usernameCheckSeqRef = useRef(0)
  const [usernameCheck, setUsernameCheck] = useState(
    /** @type {'idle' | 'debouncing' | 'checking' | 'available' | 'taken' | 'error'} */ ('idle')
  )

  useEffect(() => {
    const normalized = normalizeUsernameForSignup(username)
    if (!normalized) {
      usernameCheckSeqRef.current += 1
      setUsernameCheck('idle')
      return
    }

    usernameCheckSeqRef.current += 1
    const seq = usernameCheckSeqRef.current
    setUsernameCheck('debouncing')

    const t = window.setTimeout(async () => {
      setUsernameCheck('checking')
      try {
        const available = await checkUsernameAvailability(username, {
          excludeUserId: excludeUserId || null
        })
        if (seq !== usernameCheckSeqRef.current) return
        setUsernameCheck(available ? 'available' : 'taken')
      } catch {
        if (seq !== usernameCheckSeqRef.current) return
        setUsernameCheck('error')
      }
    }, USERNAME_DEBOUNCE_MS)

    return () => window.clearTimeout(t)
  }, [username, excludeUserId])

  return { usernameCheck }
}
