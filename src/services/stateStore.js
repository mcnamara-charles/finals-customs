import { supabase } from '../lib/supabaseClient'

const STATES_TABLE = import.meta.env.VITE_SUPABASE_STATE_TABLE || 'loadout_states'
const STATE_PROFILE = import.meta.env.VITE_SUPABASE_STATE_PROFILE || 'default'

export async function fetchPersistedState() {
  if (!supabase) return null

  const { data, error } = await supabase
    .from(STATES_TABLE)
    .select('state_version, app_state')
    .eq('profile_key', STATE_PROFILE)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!data?.app_state || typeof data.app_state !== 'object') {
    return null
  }

  return {
    ...data.app_state,
    version: data.state_version || data.app_state.version
  }
}

export async function savePersistedState(state) {
  if (!supabase) return

  const { error } = await supabase
    .from(STATES_TABLE)
    .upsert(
      {
        profile_key: STATE_PROFILE,
        state_version: state.version,
        app_state: state,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'profile_key' }
    )

  if (error) {
    throw error
  }
}
