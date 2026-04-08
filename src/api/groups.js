import { supabase } from './client.js'

const MEMBER_PREVIEW_LIMIT = 3

export const GROUP_BANNER_BUCKET = 'group-banners'

const GROUP_BANNER_MAX_BYTES = 2 * 1024 * 1024
const GROUP_BANNER_MAX_DIMENSION = 1920

const GROUP_BANNER_MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

/**
 * @param {File} file
 * @returns {Promise<File>}
 */
async function optimizeGroupBannerFile(file) {
  if (typeof window === 'undefined') return file
  const mime = String(file.type || '').toLowerCase()
  const sourceUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Could not load image for optimization'))
      img.src = sourceUrl
    })
    const sourceWidth = image.naturalWidth || image.width
    const sourceHeight = image.naturalHeight || image.height
    if (!sourceWidth || !sourceHeight) return file

    const maxSide = Math.max(sourceWidth, sourceHeight)
    const scale = maxSide > GROUP_BANNER_MAX_DIMENSION ? GROUP_BANNER_MAX_DIMENSION / maxSide : 1
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale))
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight)

    // Prefer WebP for compact uploads; fallback to JPEG for broader support.
    const outputMime = 'image/webp'
    const outputExt = 'webp'
    const qualitySteps = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42]
    let bestBlob = null
    for (const q of qualitySteps) {
      // eslint-disable-next-line no-await-in-loop
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputMime, q))
      if (!blob) continue
      bestBlob = blob
      if (blob.size <= GROUP_BANNER_MAX_BYTES) break
    }
    if (!bestBlob) return file

    const baseName = String(file.name || 'banner').replace(/\.[^.]+$/, '')
    return new File([bestBlob], `${baseName}.${outputExt}`, {
      type: outputMime,
      lastModified: Date.now()
    })
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

/**
 * @param {unknown} value
 * @returns {'gradient'|'image'}
 */
export function normalizeGroupBannerMode(value) {
  return value === 'image' ? 'image' : 'gradient'
}

/**
 * @param {unknown} url
 */
export function isPlausibleGroupBannerImageUrl(url) {
  const u = String(url || '').trim()
  if (!u || u.length > 2048) return false
  return /^https:\/\//i.test(u)
}

/**
 * @param {string} userId
 * @returns {Promise<Array<{ id: string, name: string, join_code: string, gradient_color_a: string, gradient_color_b: string, banner_mode: 'gradient'|'image', banner_image_url: string | null, role: string, member_count: number, member_preview_user_ids: string[], member_preview_profiles: Array<{ user_id: string, username?: string | null, display_name?: string | null, avatar_url?: string | null, discord_user_id?: string | null, discord_avatar_hash?: string | null }> }>>}
 */
export async function fetchMyGroups(userId) {
  if (!supabase || !userId) return []

  const { data, error } = await supabase
    .from('group_memberships')
    .select(
      'role, groups (id, name, join_code, gradient_color_a, gradient_color_b, banner_mode, banner_image_url)'
    )
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
        gradient_color_a: g.gradient_color_a,
        gradient_color_b: g.gradient_color_b,
        banner_mode: normalizeGroupBannerMode(g.banner_mode),
        banner_image_url: g.banner_image_url != null ? String(g.banner_image_url).trim() || null : null,
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

  const allUserIds = [...new Set([].concat(...Array.from(userIdsByGroup.values())))]
  /** @type {Map<string, { user_id: string, username?: string | null, display_name?: string | null, avatar_url?: string | null, discord_user_id?: string | null, discord_avatar_hash?: string | null }>} */
  const profileMap = new Map()
  if (allUserIds.length) {
    const { data: profileRows, error: profileErr } = await supabase
      .from('profiles')
      .select('user_id, username, display_name, avatar_url, discord_user_id, discord_avatar_hash')
      .in('user_id', allUserIds)
    if (profileErr) throw profileErr
    for (const p of profileRows || []) {
      if (!p?.user_id) continue
      profileMap.set(p.user_id, {
        user_id: p.user_id,
        username: p.username || null,
        display_name: p.display_name || null,
        avatar_url: p.avatar_url || null,
        discord_user_id: p.discord_user_id || null,
        discord_avatar_hash: p.discord_avatar_hash || null
      })
    }
  }

  return rows.map((g) => {
    const uids = (userIdsByGroup.get(g.id) || []).slice().sort()
    const previewIds = uids.slice(0, MEMBER_PREVIEW_LIMIT)
    return {
      ...g,
      member_count: uids.length,
      member_preview_user_ids: previewIds,
      member_preview_profiles: previewIds.map((uid) => {
        const profile = profileMap.get(uid)
        if (profile) return profile
        return { user_id: uid, username: null, display_name: null, avatar_url: null, discord_user_id: null, discord_avatar_hash: null }
      })
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
 * @returns {Promise<Array<{ user_id: string, role: string, username?: string | null, display_name?: string | null, avatar_url?: string | null, discord_user_id?: string | null, discord_avatar_hash?: string | null, manual_status: 'assigned'|'available'|'unavailable' }>>}
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
      supabase
        .from('profiles')
        .select('user_id, username, display_name, avatar_url, discord_user_id, discord_avatar_hash')
        .in('user_id', userIds),
      supabase.from('group_member_availability').select('user_id, manual_status').eq('group_id', groupId)
    ])

  if (profileError) throw profileError
  if (availError) throw availError

  /** @type {Map<string, { username?: string, display_name?: string, avatar_url?: string, discord_user_id?: string, discord_avatar_hash?: string }>} */
  const profileMap = new Map()
  for (const p of profileRows || []) {
    if (!p?.user_id) continue
    profileMap.set(p.user_id, {
      username: p.username || null,
      display_name: p.display_name || null,
      avatar_url: p.avatar_url || null,
      discord_user_id: p.discord_user_id || null,
      discord_avatar_hash: p.discord_avatar_hash || null
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

/**
 * @param {string} groupId
 */
export async function leaveGroup(groupId) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!groupId) throw new Error('Missing group id')
  const { error } = await supabase.rpc('leave_group', {
    p_group_id: groupId
  })
  if (error) throw error
}

/**
 * @param {string} groupId
 * @param {string} newOwnerUserId
 */
export async function transferGroupOwnership(groupId, newOwnerUserId) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!groupId) throw new Error('Missing group id')
  if (!newOwnerUserId) throw new Error('Missing new owner id')
  const { error } = await supabase.rpc('transfer_group_ownership', {
    p_group_id: groupId,
    p_new_owner_user_id: newOwnerUserId
  })
  if (error) throw error
}

/**
 * @param {string} groupId
 * @returns {Promise<string>} new join code
 */
export async function rotateGroupJoinCode(groupId) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!groupId) throw new Error('Missing group id')
  const { data, error } = await supabase.rpc('rotate_group_join_code', {
    p_group_id: groupId
  })
  if (error) throw error
  return data
}

/**
 * @param {string} groupId
 */
export async function deleteGroup(groupId) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!groupId) throw new Error('Missing group id')
  const { error } = await supabase.rpc('delete_group', {
    p_group_id: groupId
  })
  if (error) throw error
}

/**
 * @param {string} groupId
 * @param {string} colorA
 * @param {string} colorB
 */
export async function setGroupGradientColors(groupId, colorA, colorB) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!groupId) throw new Error('Missing group id')
  if (!colorA || !colorB) throw new Error('Missing gradient colors')

  const { error } = await supabase.rpc('set_group_gradient_colors', {
    group_id: groupId,
    color_a: colorA,
    color_b: colorB
  })
  if (error) throw error
}

/**
 * @param {string} groupId
 * @param {File} file
 * @returns {Promise<string>} public URL
 */
export async function uploadGroupBannerImage(groupId, file) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!groupId) throw new Error('Missing group id')
  if (!file || typeof file !== 'object') throw new Error('Missing image file')

  const mime = String(file.type || '').toLowerCase()
  const ext = GROUP_BANNER_MIME_TO_EXT[mime]
  if (!ext) throw new Error('Use a PNG, JPEG, WebP, or GIF image')

  const optimizedFile = await optimizeGroupBannerFile(file)
  const uploadMime = String(optimizedFile.type || '').toLowerCase()
  const uploadExt = GROUP_BANNER_MIME_TO_EXT[uploadMime] || ext

  const objectId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
  const path = `${groupId}/${objectId}.${uploadExt}`

  const { error: upErr } = await supabase.storage.from(GROUP_BANNER_BUCKET).upload(path, optimizedFile, {
    cacheControl: '3600',
    upsert: false,
    contentType: uploadMime || undefined
  })
  if (upErr) throw upErr

  const { data } = supabase.storage.from(GROUP_BANNER_BUCKET).getPublicUrl(path)
  const publicUrl = data?.publicUrl && String(data.publicUrl).trim()
  if (!publicUrl) throw new Error('Could not resolve image URL')
  return publicUrl
}

/**
 * @param {string} groupId
 * @param {'gradient'|'image'} mode
 * @param {string | null | undefined} imageUrl required when mode is image
 */
export async function setGroupBannerDisplay(groupId, mode, imageUrl) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!groupId) throw new Error('Missing group id')
  const normalizedMode = normalizeGroupBannerMode(mode)
  const trimmedUrl = imageUrl != null ? String(imageUrl).trim() : ''

  const { error } = await supabase.rpc('set_group_banner_display', {
    p_group_id: groupId,
    p_mode: normalizedMode,
    p_image_url: normalizedMode === 'image' ? trimmedUrl : null
  })
  if (error) throw error
}

/**
 * @param {string} groupId
 * @param {string} groupName
 */
export async function setGroupName(groupId, groupName) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!groupId) throw new Error('Missing group id')
  const name = String(groupName || '').trim()
  if (!name) throw new Error('Group name is required')

  const { error } = await supabase.rpc('set_group_name', {
    p_group_id: groupId,
    p_name: name
  })
  if (error) throw error
}
