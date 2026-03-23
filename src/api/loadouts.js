import { supabase } from './client.js'

const LEGACY_STATES_TABLE = import.meta.env.VITE_SUPABASE_STATE_TABLE || 'loadout_states'
const LEGACY_STATE_PROFILE = import.meta.env.VITE_SUPABASE_STATE_PROFILE || 'default'

export const GROUP_LOADOUT_STATES_TABLE = 'group_loadout_states'
const USER_GROUP_STATES_TABLE = 'user_group_loadout_states'

/** @param {Record<string, unknown>} state */
function stripSidebarFromState(state) {
  const rest = { ...state }
  delete rest.isSidebarCollapsed
  return rest
}

/** Legacy global row (compatibility; unused by groups path). */
export async function fetchPersistedState() {
  if (!supabase) return null

  const { data, error } = await supabase
    .from(LEGACY_STATES_TABLE)
    .select('state_version, app_state')
    .eq('profile_key', LEGACY_STATE_PROFILE)
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

/** Legacy global row (compatibility). */
export async function savePersistedState(state) {
  if (!supabase) return

  const { error } = await supabase
    .from(LEGACY_STATES_TABLE)
    .upsert(
      {
        profile_key: LEGACY_STATE_PROFILE,
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

/**
 * @param {string} groupId
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function fetchGroupPersistedState(groupId) {
  if (!supabase || !groupId) return null

  const { data, error } = await supabase
    .from(GROUP_LOADOUT_STATES_TABLE)
    .select('state_version, app_state')
    .eq('group_id', groupId)
    .maybeSingle()

  if (error) throw error

  if (!data?.app_state || typeof data.app_state !== 'object') {
    return null
  }

  return {
    ...data.app_state,
    version: data.state_version || data.app_state.version
  }
}

/**
 * @param {string} groupId
 * @param {Record<string, unknown>} state full app state blob (may include isSidebarCollapsed; it is stripped server-side)
 */
export async function saveGroupPersistedState(groupId, state) {
  if (!supabase || !groupId) return

  const payload = stripSidebarFromState(state)

  const { error } = await supabase.from(GROUP_LOADOUT_STATES_TABLE).upsert(
    {
      group_id: groupId,
      state_version: payload.version,
      app_state: payload,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'group_id' }
  )

  if (error) throw error
}

/**
 * Per-user preferences for a group (e.g. sidebar).
 * @param {string} groupId
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function fetchUserGroupPersistedState(groupId) {
  if (!supabase || !groupId) return null

  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user?.id) return null

  const { data, error } = await supabase
    .from(USER_GROUP_STATES_TABLE)
    .select('app_state')
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) throw error
  if (!data?.app_state || typeof data.app_state !== 'object') return null
  return data.app_state
}

/**
 * @param {string} groupId
 * @param {Record<string, unknown>} userState
 */
export async function saveUserGroupPersistedState(groupId, userState) {
  if (!supabase || !groupId) return

  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user?.id) return

  const { error } = await supabase.from(USER_GROUP_STATES_TABLE).upsert(
    {
      user_id: user.id,
      group_id: groupId,
      app_state: userState,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id,group_id' }
  )

  if (error) throw error
}
