import { GROUP_LOADOUT_STATES_TABLE } from './loadouts.js'

/**
 * Subscribe to Postgres changes for a group's shared loadout row.
 * @param {import('@supabase/supabase-js').SupabaseClient | null} supabase
 * @param {string} groupId
 * @param {() => void} onChange
 * @returns {() => void} cleanup (remove channel)
 */
export function subscribeToGroupLoadoutChanges(supabase, groupId, onChange) {
  if (!supabase || !groupId) {
    return () => {}
  }

  const channel = supabase
    .channel(`group-loadout-state-${groupId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: GROUP_LOADOUT_STATES_TABLE,
        filter: `group_id=eq.${groupId}`
      },
      onChange
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

/**
 * Subscribe to membership changes for the active group.
 * @param {import('@supabase/supabase-js').SupabaseClient | null} supabase
 * @param {string} groupId
 * @param {() => void} onChange
 * @returns {() => void} cleanup (remove channel)
 */
export function subscribeToGroupMembershipChanges(supabase, groupId, onChange) {
  if (!supabase || !groupId) {
    return () => {}
  }

  const channel = supabase
    .channel(`group-memberships-${groupId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'group_memberships',
        filter: `group_id=eq.${groupId}`
      },
      onChange
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

/**
 * Subscribe to manual availability changes for the active group.
 * @param {import('@supabase/supabase-js').SupabaseClient | null} supabase
 * @param {string} groupId
 * @param {() => void} onChange
 * @returns {() => void} cleanup (remove channel)
 */
export function subscribeToGroupAvailabilityChanges(supabase, groupId, onChange) {
  if (!supabase || !groupId) {
    return () => {}
  }

  const channel = supabase
    .channel(`group-availability-${groupId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'group_member_availability',
        filter: `group_id=eq.${groupId}`
      },
      onChange
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
