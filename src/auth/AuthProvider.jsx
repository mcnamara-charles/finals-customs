import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { AuthContext } from './authContext'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)

  const refreshAuth = useCallback(async () => {
    if (!supabase) return
    const {
      data: { session: next }
    } = await supabase.auth.getSession()
    setSession(next)
  }, [])

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true)
      setSession(null)
      return
    }

    let mounted = true

    const init = async () => {
      const {
        data: { session: initialSession }
      } = await supabase.auth.getSession()
      if (!mounted) return
      setSession(initialSession)
      setAuthReady(true)
    }

    init()

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(
    () => ({ session, authReady, refreshAuth }),
    [session, authReady, refreshAuth]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
