import { supabase } from './client.js'

const MEMBER_PREVIEW_LIMIT = 3

/**
 * @param {string} userId
 * @returns {Promise<Array<{ id: string, name: string, join_code: string, role: string, member_count: number, member_preview_user_ids: string[] }>>}
 */
export async function fetchMyGroups(userId) {
  if (!supabase || !userId) return []

  const { data, error } = await supabase
    .from('group_memberships')
    .select('role, groups (id, name, join_code)')
    .eq('user_id', userId)

  if (error) throw error

  const rows = (data || [])
    .map((row) => {
      const g = row.groups
      if (!g || typeof g !== 'object') return null
      return {
        id: g.id,
        name: g.name,
        join_code: g.join_code,
        role: row.role
      }
    })
    .filter(Boolean)

  const groupIds = [...new Set(rows.map((r) => r.id))]
  /** @type {Map<string, string[]>} */
  const userIdsByGroup = new Map()
  if (groupIds.length) {
    const { data: memRows, error: memErr } = await supabase
      .from('group_memberships')
      .select('group_id, user_id')
      .in('group_id', groupIds)
    if (memErr) throw memErr
    for (const m of memRows || []) {
      const gid = m.group_id
      const uid = m.user_id
      if (!gid || !uid) continue
      if (!userIdsByGroup.has(gid)) userIdsByGroup.set(gid, [])
      userIdsByGroup.get(gid).push(uid)
    }
  }

  return rows.map((g) => {
    const uids = (userIdsByGroup.get(g.id) || []).slice().sort()
    return {
      ...g,
      member_count: uids.length,
      member_preview_user_ids: uids.slice(0, MEMBER_PREVIEW_LIMIT)
    }
  })
}

/**
 * @param {string} userId
 * @param {string} groupId
 * @returns {Promise<'owner'|'admin'|'member'|null>}
 */
export async function fetchRoleInGroup(userId, groupId) {
  if (!supabase || !userId || !groupId) return null

  const { data, error } = await supabase
    .from('group_memberships')
    .select('role')
    .eq('user_id', userId)
    .eq('group_id', groupId)
    .maybeSingle()

  if (error) throw error
  const r = data?.role
  if (r === 'owner' || r === 'admin' || r === 'member') return r
  return null
}

/** @type {readonly ['assigned', 'available', 'unavailable']} */
export const GROUP_MANUAL_STATUSES = ['assigned', 'available', 'unavailable']

/**
 * @param {unknown} value
 * @returns {'assigned'|'available'|'unavailable'}
 */
export function normalizeGroupManualStatus(value) {
  if (value === 'assigned' || value === 'available' || value === 'unavailable') return value
  return 'available'
}

/**
 * Active group members from `group_memberships` (RLS applies).
 * @param {string} groupId
 * @returns {Promise<Array<{ user_id: string, role: string, display_name?: string | null, avatar_url?: string | null, manual_status: 'assigned'|'available'|'unavailable' }>>}
 */
export async function fetchGroupMembers(groupId) {
  if (!supabase || !groupId) return []

  const { data, error } = await supabase
    .from('group_memberships')
    .select('user_id, role')
    .eq('group_id', groupId)

  if (error) throw error
  const rows = (data || []).filter((row) => row?.user_id)
  const userIds = [...new Set(rows.map((row) => row.user_id))]
  if (!userIds.length) return rows

  const [{ data: profileRows, error: profileError }, { data: availRows, error: availError }] =
    await Promise.all([
      supabase.from('profiles').select('user_id, display_name, avatar_url').in('user_id', userIds),
      supabase.from('group_member_availability').select('user_id, manual_status').eq('group_id', groupId)
    ])

  if (profileError) throw profileError
  if (availError) throw availError

  /** @type {Map<string, { display_name?: string, avatar_url?: string }>} */
  const profileMap = new Map()
  for (const p of profileRows || []) {
    if (!p?.user_id) continue
    profileMap.set(p.user_id, {
      display_name: p.display_name || null,
      avatar_url: p.avatar_url || null
    })
  }

  /** @type {Map<string, 'assigned'|'available'|'unavailable'>} */
  const statusMap = new Map()
  for (const a of availRows || []) {
    if (!a?.user_id) continue
    statusMap.set(a.user_id, normalizeGroupManualStatus(a.manual_status))
  }

  return rows.map((row) => ({
    ...row,
    ...(profileMap.get(row.user_id) || {}),
    manual_status: statusMap.get(row.user_id) ?? 'available'
  }))
}

/**
 * Upsert manual status for a group member row (RLS enforces owner/admin/self rules).
 * @param {string} groupId
 * @param {string} targetUserId
 * @param {'assigned'|'available'|'unavailable'} manualStatus
 */
export async function upsertGroupMemberManualStatus(groupId, targetUserId, manualStatus) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!groupId) throw new Error('Missing group id')
  if (!targetUserId) throw new Error('Missing user id')

  const normalized = normalizeGroupManualStatus(manualStatus)
  if (normalized !== manualStatus) {
    throw new Error('Invalid manual status')
  }

  const {
    data: { session }
  } = await supabase.auth.getSession()
  if (!session?.user?.id) throw new Error('Not authenticated')

  const { error } = await supabase.from('group_member_availability').upsert(
    {
      group_id: groupId,
      user_id: targetUserId,
      manual_status: normalized,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'group_id,user_id' }
  )
  if (error) throw error
}

/**
 * @param {string} joinCode
 * @returns {Promise<string>} group id
 */
export async function joinGroupByCode(joinCode) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('join_group_by_code', {
    p_code: joinCode
  })
  if (error) throw error
  return data
}

/**
 * @param {string} name
 * @returns {Promise<string>} new group id
 */
export async function createGroup(name) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('create_group', { p_name: name })
  if (error) throw error
  return data
}

/**
 * @param {string} groupId
 * @param {string} userId
 * @param {'admin'|'member'} role
 */
export async function setGroupMemberRole(groupId, userId, role) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!groupId) throw new Error('Missing group id')
  if (!userId) throw new Error('Missing user id')
  if (role !== 'admin' && role !== 'member') throw new Error('Invalid role')

  const { error } = await supabase.rpc('set_group_member_role', {
    p_group_id: groupId,
    p_user_id: userId,
    p_role: role
  })
  if (error) throw error
}

/**
 * @param {string} groupId
 * @param {string} userId
 */
export async function removeGroupMember(groupId, userId) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!groupId) throw new Error('Missing group id')
  if (!userId) throw new Error('Missing user id')

  const { error } = await supabase.rpc('remove_group_member', {
    p_group_id: groupId,
    p_user_id: userId
  })
  if (error) throw error
}
