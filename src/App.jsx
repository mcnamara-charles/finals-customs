import { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import './App.css'
import './layouts.css'
import gameConfig from '../game-config.json'
import mapsConfig from '../maps-config.json'
import { computeDynamicLayout } from './features/layout/layoutEngine'
import { isDynamicLayoutModeConfig } from './features/layout/dynamicMode'
import {
  applyTeamDragDrop,
  firstEmptySlotIndex,
  parseTeamDragTransfer,
  previewTeamDragDrop,
  removeParticipantFromAssignments,
  setTeamDragTransferData
} from './features/teamDragDrop/engine'
import DynamicLayoutRoot from './components/DynamicLayout/DynamicLayoutRoot'
import { FullPageLoading } from './components/FullPageLoading'
import { UserSettingsPanel } from './components/UserSettingsPanel'
import {
  GroupsDashboardCreateTileSkeleton,
  GroupsDashboardTileSkeleton,
  ParticipantsListSkeleton
} from './components/LoadingSkeletons'
import { supabase } from './lib/supabaseClient'
import {
  subscribeToGroupLoadoutChanges,
  subscribeToGroupMembershipChanges,
  subscribeToGroupAvailabilityChanges
} from './api/realtime'
import {
  fetchGroupPersistedState,
  saveGroupPersistedState,
} from './services/stateStore'
import { signOut as authSignOut } from './services/authService'
import { useAuth } from './auth/authContext'
import {
  fetchMyGroups,
  fetchRoleInGroup,
  joinGroupByCode,
  createGroup,
  fetchGroupMembers,
  upsertGroupMemberManualStatus,
  setGroupMemberRole,
  removeGroupMember,
  leaveGroup,
  transferGroupOwnership,
  normalizeGroupManualStatus
} from './services/groupService'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowLeft,
  faArrowRotateRight,
  faChevronLeft,
  faChevronRight,
  faCloudSunRain,
  faCrown,
  faDice,
  faEllipsisVertical,
  faGamepad,
  faGear,
  faLock,
  faLockOpen,
  faUnlock,
  faMap,
  faPlus,
  faSliders,
  faUserShield,
  faXmark
} from '@fortawesome/free-solid-svg-icons'

const STATE_VERSION = '1.0.0'
const SETTINGS_ALL_PLAYERS = '__all_players__'
const SIDEBAR_OVERLAY_BREAKPOINT = 1440
const SIDEBAR_COLLAPSE_DEFAULT_BREAKPOINT = 800
const DASHBOARD_SIDEBAR_OVERLAY_BREAKPOINT = 800
const LOADOUTS_MOBILE_PANEL_BREAKPOINT = 500
const VIEWPORT_MENU_PAD = 8
const MENU_TRIGGER_GAP = 4

function clampMainMenuToViewport(menuEl, triggerRect) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const pad = VIEWPORT_MENU_PAD
  const gap = MENU_TRIGGER_GAP
  const w = menuEl.getBoundingClientRect().width
  const h = menuEl.scrollHeight

  let left = triggerRect.right
  left = Math.min(Math.max(left, pad + w), vw - pad)

  let top = triggerRect.bottom + gap
  let maxHeightPx = undefined

  if (top + h <= vh - pad) {
    // fits below trigger
  } else {
    const topAbove = triggerRect.top - h - gap
    if (topAbove >= pad) {
      top = topAbove
    } else {
      const spaceBelow = vh - pad - (triggerRect.bottom + gap)
      const spaceAbove = triggerRect.top - gap - pad
      if (spaceBelow >= spaceAbove) {
        top = triggerRect.bottom + gap
        maxHeightPx = Math.max(0, spaceBelow)
      } else {
        top = pad
        maxHeightPx = Math.max(0, spaceAbove)
      }
    }
  }

  return {
    left,
    top,
    ...(maxHeightPx != null ? { maxHeightPx, overflowY: 'auto' } : {})
  }
}

function layoutActionsSubmenuInViewport(subEl, setSubStyle) {
  if (!subEl) {
    setSubStyle({})
    return
  }
  const cleared = {
    left: undefined,
    right: undefined,
    marginLeft: undefined,
    marginRight: undefined,
    maxHeight: undefined,
    overflowY: undefined
  }
  flushSync(() => setSubStyle(cleared))

  const vw = window.innerWidth
  const vh = window.innerHeight
  const pad = VIEWPORT_MENU_PAD
  const r1 = subEl.getBoundingClientRect()
  const needsFlip = r1.right > vw - pad
  const flipStyle = needsFlip
    ? { left: 'auto', right: '100%', marginLeft: 0, marginRight: '0.3rem' }
    : {}

  if (needsFlip) {
    flushSync(() => setSubStyle({ ...cleared, ...flipStyle }))
  }

  const r2 = needsFlip ? subEl.getBoundingClientRect() : r1
  const subH = r2.height
  let maxH = undefined
  if (r2.bottom > vh - pad) {
    maxH = vh - pad - Math.max(pad, r2.top)
  }
  if (r2.top < pad) {
    const capFromTop = r2.bottom - 2 * pad
    maxH = maxH != null ? Math.min(maxH, capFromTop) : capFromTop
  }
  const extra = {}
  if (maxH != null && maxH < subH - 0.5) {
    extra.maxHeight = Math.max(0, maxH)
    extra.overflowY = 'auto'
  }
  setSubStyle({ ...cleared, ...flipStyle, ...extra })
}

const stableSerialize = (value) => {
  const normalize = (input) => {
    if (Array.isArray(input)) {
      return input.map(normalize)
    }
    if (input && typeof input === 'object') {
      return Object.keys(input)
        .sort()
        .reduce((acc, key) => {
          acc[key] = normalize(input[key])
          return acc
        }, {})
    }
    return input
  }

  return JSON.stringify(normalize(value))
}

// Icon Components (Font Awesome; names preserved for call sites).
// Sizing lives in App.css so responsive/context rules are not overridden by inline styles.
const FA_ICON_CLASS = 'app-fa-icon'

const SettingsIcon = () => (
  <FontAwesomeIcon icon={faGear} className={FA_ICON_CLASS} aria-hidden />
)

const OverridesIcon = () => (
  <FontAwesomeIcon icon={faSliders} className={FA_ICON_CLASS} aria-hidden />
)

const LockIcon = () => (
  <FontAwesomeIcon icon={faUnlock} className={`${FA_ICON_CLASS} app-fa-lock`} aria-hidden />
)

const PositionLockIcon = () => (
  <FontAwesomeIcon icon={faLock} className={`${FA_ICON_CLASS} app-fa-position-lock`} aria-hidden />
)

const UnlockIcon = () => (
  <FontAwesomeIcon icon={faLockOpen} className={`${FA_ICON_CLASS} app-fa-lock`} aria-hidden />
)

const SmallDiceIcon = () => (
  <FontAwesomeIcon icon={faDice} className={`${FA_ICON_CLASS} app-fa-dice-sm`} aria-hidden />
)

const DiceIcon = () => (
  <FontAwesomeIcon icon={faDice} className={`${FA_ICON_CLASS} app-fa-dice`} aria-hidden />
)

const ModeIcon = () => (
  <FontAwesomeIcon icon={faGamepad} className={FA_ICON_CLASS} aria-hidden />
)

const MapIcon = () => (
  <FontAwesomeIcon icon={faMap} className={FA_ICON_CLASS} aria-hidden />
)

const WeatherIcon = () => (
  <FontAwesomeIcon icon={faCloudSunRain} className={FA_ICON_CLASS} aria-hidden />
)

const RefreshIcon = () => (
  <FontAwesomeIcon icon={faArrowRotateRight} className={FA_ICON_CLASS} aria-hidden />
)

const ParticipantMenuDotsIcon = () => (
  <FontAwesomeIcon icon={faEllipsisVertical} className={FA_ICON_CLASS} aria-hidden />
)

const ChevronLeftIcon = () => (
  <FontAwesomeIcon icon={faChevronLeft} className={FA_ICON_CLASS} aria-hidden />
)

const ChevronRightIcon = () => (
  <FontAwesomeIcon icon={faChevronRight} className={FA_ICON_CLASS} aria-hidden />
)

const DASHBOARD_MEMBER_CHIP_PREVIEW = 3
/** Placeholder group tiles (excluding create) while the groups list loads. */
const DASHBOARD_GROUP_TILE_SKELETON_COUNT = 6
/** Same pattern as the groups bootstrap effect (`?group=` deep link). */
const GROUP_UUID_PARAM_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function hashString32(str) {
  let h = 0
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0
  }
  return h >>> 0
}

function groupDashboardBannerStyle(groupId) {
  const h = hashString32(groupId)
  const h1 = h % 360
  const h2 = Math.imul(h, 7919) % 360
  return {
    background: `linear-gradient(128deg, hsl(${h1} 72% var(--app-banner-stop-a)) 0%, hsl(${h2} 58% var(--app-banner-stop-b)) 100%)`
  }
}

function memberChipColor(userId) {
  const hue = hashString32(userId) % 360
  return `hsl(${hue} var(--app-member-chip-s) var(--app-member-chip-l))`
}

/** @param {Array<{ user_id: string }>} memberRows */
function orderGroupMemberRows(memberRows, viewerUserId) {
  const viewerId = String(viewerUserId || '').trim()
  const byId = new Map()
  for (const r of memberRows || []) {
    if (!r?.user_id) continue
    if (!byId.has(r.user_id)) byId.set(r.user_id, r)
  }
  const roleRank = (role) => {
    if (role === 'owner') return 0
    if (role === 'admin') return 1
    if (role === 'member') return 2
    return 3
  }
  const rowLabel = (row) =>
    String(row?.username || row?.display_name || '')
      .trim()
      .toLowerCase()

  return [...byId.values()].sort((a, b) => {
    const aIsViewer = viewerId && a.user_id === viewerId
    const bIsViewer = viewerId && b.user_id === viewerId
    if (aIsViewer !== bIsViewer) return aIsViewer ? -1 : 1

    const aRoleRank = roleRank(a?.role)
    const bRoleRank = roleRank(b?.role)
    if (aRoleRank !== bRoleRank) return aRoleRank - bRoleRank

    if (aRoleRank === 1 || aRoleRank === 2) {
      const aLabel = rowLabel(a)
      const bLabel = rowLabel(b)
      if (aLabel !== bLabel) return aLabel.localeCompare(bLabel)
    }
    return a.user_id.localeCompare(b.user_id)
  })
}

/** @param {string} [handle] display name / username for fallback initials */
function twoLetterAvatarLabel(handle) {
  const t = String(handle || '').trim()
  if (!t) return 'Me'
  const a = t[0] || ''
  const b = t.length > 1 ? t[1] : a
  return (a + b).toUpperCase()
}

/** @param {string | null | undefined} rawUrl */
function normalizeAvatarUrl(rawUrl) {
  const u = String(rawUrl || '').trim()
  if (!u) return ''
  return u
}

/** @param {string | null | undefined} discordUserId @param {string | null | undefined} avatarHash */
function buildDiscordAvatarUrl(discordUserId, avatarHash) {
  const userId = String(discordUserId || '').trim()
  const hash = String(avatarHash || '').trim()
  if (!userId || !hash) return ''
  const ext = hash.startsWith('a_') ? 'gif' : 'png'
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}?size=256`
}

/** @param {{ avatar_url?: string | null, discord_user_id?: string | null, discord_avatar_hash?: string | null }} row @param {string} label */
function participantAvatarSrc(row, label) {
  const discordAvatar = buildDiscordAvatarUrl(row?.discord_user_id, row?.discord_avatar_hash)
  if (discordAvatar) return discordAvatar
  const u = normalizeAvatarUrl(row?.avatar_url)
  if (u) return u
  const initials = twoLetterAvatarLabel(label)
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=64748b&color=f8fafc&size=96&bold=true`
}

/** @param {Array<{ user_id: string, username?: string | null, display_name?: string | null }>} memberRows */
function canEditGroupManualStatus({ actorRole, actorUserId, targetUserId, targetMembershipRole }) {
  if (actorUserId === targetUserId) return true
  if (actorRole === 'owner') return true
  if (actorRole === 'admin' && targetMembershipRole === 'member') return true
  return false
}

/** @param {'owner'|'admin'|'member'|null|undefined} actorRole @param {string} targetMembershipRole */
function canRemoveGroupMemberFromGroup(actorRole, targetMembershipRole) {
  if (actorRole === 'owner' && targetMembershipRole !== 'owner') return true
  if (actorRole === 'admin' && targetMembershipRole === 'member') return true
  return false
}

function groupManualStatusLabel(status) {
  if (status === 'assigned') return 'Assigned'
  if (status === 'unavailable') return 'Unavailable'
  return 'Available'
}

function loadoutHasAnyFilled(lo) {
  if (!lo) return false
  if (lo.class) return true
  if (lo.specialization) return true
  if (lo.weapon) return true
  if (Array.isArray(lo.gadgets) && lo.gadgets.some(Boolean)) return true
  return false
}

function buildGroupMemberLabelMap(memberRows, sessionUserId, selfDisplayName) {
  const map = {}
  for (const row of memberRows || []) {
    const id = row?.user_id
    if (!id) continue
    if (id === sessionUserId) {
      map[id] = selfDisplayName || `You (${id.slice(0, 8)})`
    } else if (row?.username || row?.display_name) {
      map[id] = row.username || row.display_name
    } else {
      map[id] = 'Member'
    }
  }
  return map
}

function App() {
  const navigate = useNavigate()
  const { search: locationSearch } = useLocation()
  const { session } = useAuth()
  const [selectedGamemode, setSelectedGamemode] = useState(null)
  const [selectedMapId, setSelectedMapId] = useState(null) // e.g., "bernal__standard"
  const [selectedWeather, setSelectedWeather] = useState(null)
  const [selectedLoadoutRandomTarget, setSelectedLoadoutRandomTarget] = useState('')
  const [activeGroupId, setActiveGroupId] = useState(null)
  const [groupRole, setGroupRole] = useState(null)
  const [myGroups, setMyGroups] = useState([])
  const [groupsLoadError, setGroupsLoadError] = useState('')
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [joinBusy, setJoinBusy] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [createGroupBusy, setCreateGroupBusy] = useState(false)
  const [createGroupModalOpen, setCreateGroupModalOpen] = useState(false)
  const [groupsInitialised, setGroupsInitialised] = useState(false)
  const [lockedGamemode, setLockedGamemode] = useState(false)
  const [lockedMap, setLockedMap] = useState(false)
  const [lockedWeather, setLockedWeather] = useState(false)
  const [lockedLoadoutRandomTarget, setLockedLoadoutRandomTarget] = useState(false)
  const [mobilePanelTab, setMobilePanelTab] = useState('game-options')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => window.innerWidth < SIDEBAR_COLLAPSE_DEFAULT_BREAKPOINT
  )
  const [isSidebarOverlayMode, setIsSidebarOverlayMode] = useState(
    () => window.innerWidth < SIDEBAR_OVERLAY_BREAKPOINT
  )
  const [isDashboardSidebarCollapsed, setIsDashboardSidebarCollapsed] = useState(
    () => window.innerWidth < DASHBOARD_SIDEBAR_OVERLAY_BREAKPOINT
  )
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [participants, setParticipants] = useState([])
  const [groupMemberRoster, setGroupMemberRoster] = useState([])
  const [groupMemberLabels, setGroupMemberLabels] = useState({})
  const [groupMembersReady, setGroupMembersReady] = useState(false)
  const [groupMembersError, setGroupMembersError] = useState('')
  const [onlineUserIds, setOnlineUserIds] = useState([])
  const [teamAssignments, setTeamAssignments] = useState({})
  const [lockedParticipants, setLockedParticipants] = useState({}) // { participantName: teamIndex }
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [isUserSettingsModalOpen, setIsUserSettingsModalOpen] = useState(false)
  const [isTeamSettingsModalOpen, setIsTeamSettingsModalOpen] = useState(false)
  const [balancedTeams, setBalancedTeams] = useState(true)
  const [fillFirst, setFillFirst] = useState(false)
  const [keepSeparatePairs, setKeepSeparatePairs] = useState([])
  const [keepSeparateA, setKeepSeparateA] = useState('')
  const [keepSeparateB, setKeepSeparateB] = useState('')
  const [loadouts, setLoadouts] = useState({}) // { participantName: { class, specialization, weapon, gadgets: [] } }
  const [lockedLoadouts, setLockedLoadouts] = useState({}) // { participantName: { class: true/false, specialization: true/false, weapon: true/false, gadgets: [true/false] } }
  const [loadoutSelector, setLoadoutSelector] = useState(null) // { participant, type, index } or null
  const [classInputs, setClassInputs] = useState({})
  const [classEnabled, setClassEnabled] = useState({})
  const [specializationInputs, setSpecializationInputs] = useState({})
  const [specializationEnabled, setSpecializationEnabled] = useState({})
  const [weaponInputs, setWeaponInputs] = useState({})
  const [weaponEnabled, setWeaponEnabled] = useState({})
  const [gadgetInputs, setGadgetInputs] = useState({})
  const [gadgetEnabled, setGadgetEnabled] = useState({})
  const [settingsTargetPlayer, setSettingsTargetPlayer] = useState(SETTINGS_ALL_PLAYERS)
  const [playerOverrides, setPlayerOverrides] = useState({})
  const [isTeamsPanelPortrait, setIsTeamsPanelPortrait] = useState(false)
  const [teamsPanelWidth, setTeamsPanelWidth] = useState(0)
  const [teamsPanelHeight, setTeamsPanelHeight] = useState(0)
  const [dynamicLayoutRuntimeMetrics, setDynamicLayoutRuntimeMetrics] = useState({
    teamHeaderReserve: null,
    playerNameRowHeight: null,
    assignOptionsReserve: null
  })
  const [lastStableDynamicLayout, setLastStableDynamicLayout] = useState(null)
  const [layoutRefreshNonce, setLayoutRefreshNonce] = useState(0)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const [selfProfileHandle, setSelfProfileHandle] = useState('')
  const [selfProfileAvatarUrl, setSelfProfileAvatarUrl] = useState('')
  const [selfDiscordUserId, setSelfDiscordUserId] = useState('')
  const [selfDiscordAvatarHash, setSelfDiscordAvatarHash] = useState('')
  const [refreshProfilePictureBusy, setRefreshProfilePictureBusy] = useState(false)
  const [participantActionsMenuUserId, setParticipantActionsMenuUserId] = useState(null)
  const [participantActionsTeamsSubOpen, setParticipantActionsTeamsSubOpen] = useState(false)
  const [participantActionsMenuPosition, setParticipantActionsMenuPosition] = useState(null)
  const [participantActionsTeamsSubStyle, setParticipantActionsTeamsSubStyle] = useState({})
  const participantActionsMenuRef = useRef(null)
  const participantMenuTriggerRectRef = useRef(null)
  const [assignedSlotMenuKey, setAssignedSlotMenuKey] = useState(null)
  const [assignedSlotMenuPosition, setAssignedSlotMenuPosition] = useState(null)
  const [assignedSlotSubmenuStyle, setAssignedSlotSubmenuStyle] = useState({})
  const assignedSlotMenuRef = useRef(null)
  const assignedSlotMenuTriggerRectRef = useRef(null)
  const [viewportMenuLayoutTick, setViewportMenuLayoutTick] = useState(0)
  const [assignedSlotMenuMoveSubOpen, setAssignedSlotMenuMoveSubOpen] = useState(false)
  const [assignedSlotMenuSwapSubOpen, setAssignedSlotMenuSwapSubOpen] = useState(false)
  const isInitialLoad = useRef(true)
  const skipNextPersistRef = useRef(false)
  const lastGroupPersistedRef = useRef('')
  /** Last `activeGroupId` whose persisted-state load finished; reset when the group changes. */
  const lastLoadedGroupIdRef = useRef(null)
  const teamsPanelRef = useRef(null)
  const profileMenuButtonRef = useRef(null)
  const profileMenuRef = useRef(null)
  const teamDnDRef = useRef(null)
  const [teamDnD, setTeamDnD] = useState(null)
  const [teamDnDHover, setTeamDnDHover] = useState(null)
  const [participantsDropHover, setParticipantsDropHover] = useState(false)
  const [participantsListHasOverflow, setParticipantsListHasOverflow] = useState(false)
  const [linkedParticipantPulseId, setLinkedParticipantPulseId] = useState(null)
  const linkedParticipantPulseTimeoutRef = useRef(null)
  const participantsListRef = useRef(null)
  const isViewOnlyMode = groupRole === 'member'
  const isDashboardSidebarOverlayMode = viewportWidth < DASHBOARD_SIDEBAR_OVERLAY_BREAKPOINT
  const useMobilePanelTabs = viewportWidth < LOADOUTS_MOBILE_PANEL_BREAKPOINT
  const showGameOptionsPanel = !useMobilePanelTabs || mobilePanelTab === 'game-options'
  const showParticipantsPanel = !useMobilePanelTabs || mobilePanelTab === 'participants'
  /** Owners/admins use collapsed summary when sidebar is collapsed; members always see full panel. */
  const sidebarShowsCollapsedChrome = isSidebarCollapsed && !isViewOnlyMode
  /** Overlay spacer/backdrop and `is-overlay` class apply only for roles that use collapsible overlay sidebar. */
  const sidebarOverlayChromeVisible =
    !isViewOnlyMode && isSidebarOverlayMode && !isSidebarCollapsed

  const endTeamDnD = useCallback(() => {
    teamDnDRef.current = null
    setTeamDnD(null)
    setTeamDnDHover(null)
    setParticipantsDropHover(false)
  }, [])

  const pulseAssignedParticipantInLoadout = useCallback((participantId) => {
    if (!participantId) return
    if (linkedParticipantPulseTimeoutRef.current) {
      clearTimeout(linkedParticipantPulseTimeoutRef.current)
    }
    setLinkedParticipantPulseId(participantId)
    linkedParticipantPulseTimeoutRef.current = setTimeout(() => {
      setLinkedParticipantPulseId((prev) => (prev === participantId ? null : prev))
      linkedParticipantPulseTimeoutRef.current = null
    }, 650)
  }, [])

  const beginTeamDrag = useCallback((e, payload) => {
    teamDnDRef.current = payload
    setTeamDnD(payload)
    setTeamDragTransferData(e.dataTransfer, payload)
  }, [])

  useEffect(() => {
    window.addEventListener('dragend', endTeamDnD)
    return () => window.removeEventListener('dragend', endTeamDnD)
  }, [endTeamDnD])

  useEffect(
    () => () => {
      if (linkedParticipantPulseTimeoutRef.current) {
        clearTimeout(linkedParticipantPulseTimeoutRef.current)
      }
    },
    []
  )

  const loadSelfProfile = useCallback(async () => {
    const sessionUserId = session?.user?.id
    if (!sessionUserId || !supabase) {
      setSelfProfileHandle('')
      setSelfProfileAvatarUrl('')
      setSelfDiscordUserId('')
      setSelfDiscordAvatarHash('')
      return
    }

    setSelfProfileHandle('')
    setSelfProfileAvatarUrl('')
    setSelfDiscordUserId('')
    setSelfDiscordAvatarHash('')

    const { data, error } = await supabase
      .from('profiles')
      .select('username, display_name, avatar_url, discord_user_id, discord_avatar_hash')
      .eq('user_id', sessionUserId)
      .maybeSingle()

    if (error || !data) return
    setSelfProfileHandle((data.username || data.display_name || '').trim())
    setSelfProfileAvatarUrl(normalizeAvatarUrl(data.avatar_url))
    setSelfDiscordUserId((data.discord_user_id || '').trim())
    setSelfDiscordAvatarHash((data.discord_avatar_hash || '').trim())
  }, [session?.user?.id])

  useEffect(() => {
    loadSelfProfile()
  }, [loadSelfProfile])

  const profileDisplayName = useMemo(() => {
    if (selfProfileHandle) return selfProfileHandle
    const u = (session?.user?.user_metadata?.username || '').trim()
    if (u) return u
    const email = session?.user?.email || ''
    const local = email.includes('@') ? email.split('@')[0] : email
    return local.trim() || 'Profile'
  }, [selfProfileHandle, session?.user?.email, session?.user?.user_metadata?.username])
  const profileAvatarUrl = useMemo(() => {
    const metadataDiscordUserId = session?.user?.user_metadata?.provider_id
    const metadataDiscordAvatarHash = session?.user?.user_metadata?.avatar
    const discordAvatar =
      buildDiscordAvatarUrl(selfDiscordUserId, selfDiscordAvatarHash) ||
      buildDiscordAvatarUrl(metadataDiscordUserId, metadataDiscordAvatarHash)
    if (discordAvatar) return discordAvatar
    const explicitAvatar = normalizeAvatarUrl(
      selfProfileAvatarUrl ||
        session?.user?.user_metadata?.avatar_url ||
        session?.user?.user_metadata?.picture
    )
    if (explicitAvatar) return explicitAvatar
    const initials = twoLetterAvatarLabel(profileDisplayName)
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=64748b&color=f8fafc&size=96&bold=true`
  }, [
    profileDisplayName,
    selfProfileAvatarUrl,
    selfDiscordUserId,
    selfDiscordAvatarHash,
    session?.user?.user_metadata?.provider_id,
    session?.user?.user_metadata?.avatar,
    session?.user?.user_metadata?.avatar_url,
    session?.user?.user_metadata?.picture
  ])

  const pruneInvalidParticipantReferences = useCallback((validIds) => {
    const valid = new Set(validIds)
    setTeamAssignments((prev) => {
      let changed = false
      const next = {}
      for (const [k, arr] of Object.entries(prev || {})) {
        const list = arr || []
        const filtered = list.filter((p) => valid.has(p))
        if (filtered.length !== list.length) changed = true
        next[k] = filtered
      }
      return changed ? next : prev
    })
    setLockedParticipants((prev) => {
      const next = {}
      let changed = false
      for (const [p, ti] of Object.entries(prev || {})) {
        if (valid.has(p)) next[p] = ti
        else changed = true
      }
      return changed ? next : prev
    })
    setLoadouts((prev) => {
      const next = { ...prev }
      let changed = false
      for (const key of Object.keys(next)) {
        if (!valid.has(key)) {
          delete next[key]
          changed = true
        }
      }
      return changed ? next : prev
    })
    setLockedLoadouts((prev) => {
      const next = { ...prev }
      let changed = false
      for (const key of Object.keys(next)) {
        if (!valid.has(key)) {
          delete next[key]
          changed = true
        }
      }
      return changed ? next : prev
    })
    setPlayerOverrides((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([k]) => valid.has(k)))
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
    setKeepSeparatePairs((prev) => {
      const next = prev.filter((pair) => valid.has(pair.playerA) && valid.has(pair.playerB))
      return next.length === prev.length ? prev : next
    })
  }, [])

  const labelForParticipant = useCallback(
    (participantId) => {
      if (!participantId) return ''
      if (participantId === session?.user?.id) return profileDisplayName
      return groupMemberLabels[participantId] || 'Member'
    },
    [session?.user?.id, profileDisplayName, groupMemberLabels]
  )

  const groupMemberRosterById = useMemo(() => {
    const m = new Map()
    for (const row of groupMemberRoster) {
      if (row?.user_id) m.set(row.user_id, row)
    }
    return m
  }, [groupMemberRoster])

  const isParticipantUnavailableForTeams = useCallback(
    (userId) => groupMemberRosterById.get(userId)?.manual_status === 'unavailable',
    [groupMemberRosterById]
  )

  const handleGroupManualStatusChange = useCallback(
    async (targetUserId, nextStatus) => {
      if (!activeGroupId || !session?.user?.id) return
      const row = groupMemberRoster.find((r) => r.user_id === targetUserId)
      if (
        !canEditGroupManualStatus({
          actorRole: groupRole,
          actorUserId: session.user.id,
          targetUserId,
          targetMembershipRole: row?.role || 'member'
        })
      ) {
        return
      }
      const normalized = normalizeGroupManualStatus(nextStatus)
      setGroupMemberRoster((prev) =>
        prev.map((r) => (r.user_id === targetUserId ? { ...r, manual_status: normalized } : r))
      )
      try {
        await upsertGroupMemberManualStatus(activeGroupId, targetUserId, normalized)
      } catch (err) {
        console.error('[Group] Failed to update manual status:', err)
        try {
          const memberRows = await fetchGroupMembers(activeGroupId)
          setGroupMemberRoster(orderGroupMemberRows(memberRows, session?.user?.id))
        } catch (_) {
          /* ignore */
        }
      }
    },
    [activeGroupId, session?.user?.id, groupRole, groupMemberRoster]
  )

  const refreshGroupMemberRoster = useCallback(async () => {
    if (!activeGroupId) return
    try {
      const memberRows = await fetchGroupMembers(activeGroupId)
      setGroupMemberRoster(orderGroupMemberRows(memberRows, session?.user?.id))
    } catch (err) {
      console.error('[Group] Failed to refresh members:', err)
    }
  }, [activeGroupId, session?.user?.id])

  const handleParticipantMenuSetRole = useCallback(
    async (userId, role) => {
      if (!activeGroupId) return
      try {
        await setGroupMemberRole(activeGroupId, userId, role)
        setParticipantActionsMenuUserId(null)
        setParticipantActionsTeamsSubOpen(false)
        setParticipantActionsMenuPosition(null)
        await refreshGroupMemberRoster()
      } catch (err) {
        console.error('[Group] Failed to set member role:', err)
      }
    },
    [activeGroupId, refreshGroupMemberRoster]
  )

  const handleParticipantMenuRemove = useCallback(
    async (userId) => {
      if (!activeGroupId) return
      try {
        await removeGroupMember(activeGroupId, userId)
        setParticipantActionsMenuUserId(null)
        setParticipantActionsTeamsSubOpen(false)
        setParticipantActionsMenuPosition(null)
        await refreshGroupMemberRoster()
      } catch (err) {
        console.error('[Group] Failed to remove member:', err)
      }
    },
    [activeGroupId, refreshGroupMemberRoster]
  )

  const handleParticipantMenuLeaveGroup = useCallback(async () => {
    if (!activeGroupId || !session?.user?.id) return
    try {
      await leaveGroup(activeGroupId)
      setParticipantActionsMenuUserId(null)
      setParticipantActionsTeamsSubOpen(false)
      setParticipantActionsMenuPosition(null)
      setActiveGroupId(null)
      setGroupRole(null)
      syncGroupInUrl(null)
      const list = await fetchMyGroups(session.user.id)
      setMyGroups(list)
    } catch (err) {
      console.error('[Group] Failed to leave group:', err)
      setGroupsLoadError(err.message || 'Could not leave group.')
    }
  }, [activeGroupId, session?.user?.id])

  const handleParticipantMenuMakeNewOwner = useCallback(
    async (userId) => {
      if (!activeGroupId || !session?.user?.id || !userId) return
      try {
        await transferGroupOwnership(activeGroupId, userId)
        setParticipantActionsMenuUserId(null)
        setParticipantActionsTeamsSubOpen(false)
        setParticipantActionsMenuPosition(null)
        const [memberRows, nextRole] = await Promise.all([
          fetchGroupMembers(activeGroupId),
          fetchRoleInGroup(session.user.id, activeGroupId)
        ])
        setGroupMemberRoster(orderGroupMemberRows(memberRows, session.user.id))
        if (nextRole) setGroupRole(nextRole)
      } catch (err) {
        console.error('[Group] Failed to transfer ownership:', err)
      }
    },
    [activeGroupId, session?.user?.id]
  )

  useEffect(() => {
    if (participantActionsMenuUserId == null) return

    const handlePointerDown = (event) => {
      const el = event.target
      if (
        typeof el?.closest === 'function' &&
        el.closest(`[data-participant-actions-wrap="${participantActionsMenuUserId}"]`)
      ) {
        return
      }
      setParticipantActionsMenuUserId(null)
      setParticipantActionsTeamsSubOpen(false)
      setParticipantActionsMenuPosition(null)
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setParticipantActionsMenuUserId(null)
        setParticipantActionsTeamsSubOpen(false)
        setParticipantActionsMenuPosition(null)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [participantActionsMenuUserId])

  const closeAssignedSlotMenu = useCallback(() => {
    setAssignedSlotMenuKey(null)
    setAssignedSlotMenuPosition(null)
    setAssignedSlotMenuMoveSubOpen(false)
    setAssignedSlotMenuSwapSubOpen(false)
    setAssignedSlotSubmenuStyle({})
  }, [])

  useEffect(() => {
    const onResize = () => setViewportMenuLayoutTick((n) => n + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useLayoutEffect(() => {
    if (participantActionsMenuUserId == null) {
      setParticipantActionsTeamsSubStyle({})
      return
    }
    const menu = participantActionsMenuRef.current
    const trig = participantMenuTriggerRectRef.current
    if (!menu || !trig) return

    const clamped = clampMainMenuToViewport(menu, trig)
    setParticipantActionsMenuPosition((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        top: clamped.top,
        left: clamped.left,
        ...(clamped.maxHeightPx != null
          ? { maxHeight: clamped.maxHeightPx, overflowY: clamped.overflowY }
          : { maxHeight: undefined, overflowY: undefined })
      }
    })

    if (!participantActionsTeamsSubOpen) {
      setParticipantActionsTeamsSubStyle({})
      return
    }
    const sub = menu.querySelector('.participant-actions-menu__sub')
    layoutActionsSubmenuInViewport(sub, setParticipantActionsTeamsSubStyle)
  }, [
    participantActionsMenuUserId,
    participantActionsTeamsSubOpen,
    viewportMenuLayoutTick
  ])

  useLayoutEffect(() => {
    if (assignedSlotMenuKey == null) {
      setAssignedSlotSubmenuStyle({})
      return
    }
    const menu = assignedSlotMenuRef.current
    const trig = assignedSlotMenuTriggerRectRef.current
    if (!menu || !trig) return

    const clamped = clampMainMenuToViewport(menu, trig)
    setAssignedSlotMenuPosition((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        top: clamped.top,
        left: clamped.left,
        ...(clamped.maxHeightPx != null
          ? { maxHeight: clamped.maxHeightPx, overflowY: clamped.overflowY }
          : { maxHeight: undefined, overflowY: undefined })
      }
    })

    const subOpen = assignedSlotMenuMoveSubOpen || assignedSlotMenuSwapSubOpen
    if (!subOpen) {
      setAssignedSlotSubmenuStyle({})
      return
    }
    const sub = menu.querySelector('.participant-actions-menu__sub')
    layoutActionsSubmenuInViewport(sub, setAssignedSlotSubmenuStyle)
  }, [
    assignedSlotMenuKey,
    assignedSlotMenuMoveSubOpen,
    assignedSlotMenuSwapSubOpen,
    viewportMenuLayoutTick
  ])

  useEffect(() => {
    if (assignedSlotMenuKey == null) return

    const handlePointerDown = (event) => {
      const el = event.target
      if (
        typeof el?.closest === 'function' &&
        el.closest(`[data-assigned-slot-menu-wrap="${assignedSlotMenuKey}"]`)
      ) {
        return
      }
      closeAssignedSlotMenu()
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        closeAssignedSlotMenu()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [assignedSlotMenuKey, closeAssignedSlotMenu])

  useEffect(() => {
    const unavailable = new Set(
      groupMemberRoster.filter((r) => r.manual_status === 'unavailable').map((r) => r.user_id)
    )
    if (unavailable.size === 0) return

    setTeamAssignments((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [k, arr] of Object.entries(next)) {
        const list = arr || []
        const filtered = list.filter((p) => !p || !unavailable.has(p))
        if (filtered.length !== list.length) changed = true
        next[k] = filtered
      }
      return changed ? next : prev
    })
    setLockedParticipants((prev) => {
      const next = { ...prev }
      let changed = false
      for (const p of Object.keys(next)) {
        if (unavailable.has(p)) {
          delete next[p]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [groupMemberRoster])

  const onlineUserIdSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds])

  const assignedParticipantIdSet = useMemo(
    () => new Set(Object.values(teamAssignments).flat().filter(Boolean)),
    [teamAssignments]
  )

  const gamemodes = useMemo(
    () =>
      Object.keys(gameConfig.gamemodes).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      ),
    []
  )
  const loadoutRandomTargets = useMemo(
    () =>
      ['Weapon', 'Specialization', '2 Gadgets'].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      ),
    []
  )

  const applyPersistedState = useCallback(
    (parsed) => {
      if (parsed.selectedGamemode !== undefined) setSelectedGamemode(parsed.selectedGamemode)
      if (parsed.participants !== undefined && !activeGroupId) setParticipants(parsed.participants)
      if (parsed.teamAssignments !== undefined) setTeamAssignments(parsed.teamAssignments)
      if (parsed.lockedParticipants !== undefined) setLockedParticipants(parsed.lockedParticipants)
      if (parsed.balancedTeams !== undefined) setBalancedTeams(parsed.balancedTeams)
      if (parsed.fillFirst !== undefined) setFillFirst(parsed.fillFirst)
      if (parsed.keepSeparatePairs !== undefined) setKeepSeparatePairs(parsed.keepSeparatePairs)
      if (parsed.loadouts) setLoadouts(parsed.loadouts)
      if (parsed.lockedLoadouts) setLockedLoadouts(parsed.lockedLoadouts)
      if (parsed.classInputs !== undefined) setClassInputs(parsed.classInputs)
      if (parsed.classEnabled !== undefined) setClassEnabled(parsed.classEnabled)
      if (parsed.specializationInputs !== undefined) setSpecializationInputs(parsed.specializationInputs)
      if (parsed.specializationEnabled !== undefined) setSpecializationEnabled(parsed.specializationEnabled)
      if (parsed.weaponInputs !== undefined) setWeaponInputs(parsed.weaponInputs)
      if (parsed.weaponEnabled !== undefined) setWeaponEnabled(parsed.weaponEnabled)
      if (parsed.gadgetInputs !== undefined) setGadgetInputs(parsed.gadgetInputs)
      if (parsed.gadgetEnabled !== undefined) setGadgetEnabled(parsed.gadgetEnabled)
      if (parsed.playerOverrides !== undefined) setPlayerOverrides(parsed.playerOverrides)
      if (parsed.selectedMapId !== undefined) setSelectedMapId(parsed.selectedMapId)
      if (parsed.selectedWeather !== undefined) setSelectedWeather(parsed.selectedWeather)
      if (parsed.selectedLoadoutRandomTarget !== undefined)
        setSelectedLoadoutRandomTarget(parsed.selectedLoadoutRandomTarget)
      if (parsed.lockedGamemode !== undefined) setLockedGamemode(parsed.lockedGamemode)
      if (parsed.lockedMap !== undefined) setLockedMap(parsed.lockedMap)
      if (parsed.lockedWeather !== undefined) setLockedWeather(parsed.lockedWeather)
      if (parsed.lockedWeather === true && parsed.lockedMap !== true) {
        setLockedMap(true)
      }
      if (parsed.lockedLoadoutRandomTarget !== undefined)
        setLockedLoadoutRandomTarget(parsed.lockedLoadoutRandomTarget)
    },
    [activeGroupId]
  )

  useEffect(() => {
    if (lockedWeather && !lockedMap) {
      setLockedMap(true)
    }
  }, [lockedWeather, lockedMap])

  // mapsConfig is a static JSON import; this effect only needs to react to map/weather state above.
  useEffect(() => {
    if (!selectedMapId) {
      if (selectedWeather != null && !lockedWeather) {
        setSelectedWeather(null)
      }
      return
    }
    const details = mapsConfig.map_modifiers[selectedMapId]
    const list = details?.weather
    if (!list || list.length === 0) {
      if (selectedWeather != null) setSelectedWeather(null)
      return
    }
    if (selectedWeather != null && !list.includes(selectedWeather)) {
      if (lockedWeather) {
        setSelectedWeather(list[Math.floor(Math.random() * list.length)])
      } else {
        setSelectedWeather(null)
      }
    }
  }, [selectedMapId, selectedWeather, lockedWeather])

  useEffect(() => {
    if (!session?.user?.id || !supabase) {
      setGroupsInitialised(false)
      setMyGroups([])
      return
    }

    let cancelled = false
    setGroupsLoadError('')
    setGroupsInitialised(false)

    ;(async () => {
      try {
        const params = new URLSearchParams(locationSearch)
        const g = params.get('group')

        if (g && GROUP_UUID_PARAM_RE.test(g)) {
          const role = await fetchRoleInGroup(session.user.id, g)
          if (cancelled) return
          if (role) {
            setActiveGroupId(g)
            setGroupRole(role)
          } else {
            const url = new URL(window.location.href)
            url.searchParams.delete('group')
            window.history.replaceState({}, '', `${url.pathname}${url.search}`)
            setGroupsLoadError('That group link is invalid or you are not a member.')
            setActiveGroupId(null)
            setGroupRole(null)
          }
        } else {
          if (g) {
            const url = new URL(window.location.href)
            url.searchParams.delete('group')
            window.history.replaceState({}, '', `${url.pathname}${url.search}`)
          }
          setActiveGroupId(null)
          setGroupRole(null)
        }

        const list = await fetchMyGroups(session.user.id)
        if (cancelled) return
        setMyGroups(list)
      } catch (error) {
        if (!cancelled) {
          setGroupsLoadError(error.message || 'Failed to load groups.')
        }
      } finally {
        if (!cancelled) setGroupsInitialised(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [session?.user?.id, locationSearch])

  useEffect(() => {
    isInitialLoad.current = true
    skipNextPersistRef.current = true
    lastGroupPersistedRef.current = ''
    setIsSidebarCollapsed(window.innerWidth < SIDEBAR_COLLAPSE_DEFAULT_BREAKPOINT)
    setParticipants([])
    setGroupMemberRoster([])
    setGroupMemberLabels({})
    setGroupMembersReady(false)
    setGroupMembersError('')
    setOnlineUserIds([])
    lastLoadedGroupIdRef.current = null
  }, [activeGroupId])

  // Load persisted state for the active group (RLS requires authentication)
  useEffect(() => {
    const sessionUserId = session?.user?.id
    if (!sessionUserId || !activeGroupId || !groupRole) {
      isInitialLoad.current = true
      return
    }

    let isCancelled = false

    const loadState = async () => {
      // Same group, new effect run (e.g. groupRole resolved): do not clear members-ready to avoid UI flicker.
      const isRepeatLoadForSameGroup = lastLoadedGroupIdRef.current === activeGroupId
      if (!isRepeatLoadForSameGroup) {
        setGroupMembersReady(false)
      }
      try {
        const parsed = await fetchGroupPersistedState(activeGroupId)
        let memberIds = null
        /** @type {Array<{ user_id: string }> | null} */
        let orderedMemberRows = null
        try {
          const memberRows = await fetchGroupMembers(activeGroupId)
          orderedMemberRows = orderGroupMemberRows(memberRows, sessionUserId)
          memberIds = orderedMemberRows.map((r) => r.user_id)
          if (!isCancelled) {
            setGroupMemberRoster(orderedMemberRows)
            setGroupMembersError('')
          }
        } catch (err) {
          console.error('[Group] Failed to load members:', err)
          if (!isCancelled) {
            setGroupMembersError(err.message || 'Failed to load group members.')
          }
        }
        if (isCancelled) return

        if (memberIds && orderedMemberRows) {
          setGroupMemberLabels(
            buildGroupMemberLabelMap(orderedMemberRows, sessionUserId, profileDisplayName)
          )
          setParticipants(memberIds)
        }

        if (parsed) {
          if (parsed.version !== STATE_VERSION) {
            console.warn('[State] Ignoring persisted state due to version mismatch')
            if (memberIds) pruneInvalidParticipantReferences(memberIds)
          } else {
            const sharedSer = stableSerialize(parsed)
            lastGroupPersistedRef.current = sharedSer
            skipNextPersistRef.current = true
            applyPersistedState(parsed)
            if (memberIds) pruneInvalidParticipantReferences(memberIds)
          }
        } else {
          if (memberIds) pruneInvalidParticipantReferences(memberIds)
        }

      } catch (error) {
        console.error('[State] Error loading persisted state:', error)
      } finally {
        if (!isCancelled) {
          isInitialLoad.current = false
          setGroupMembersReady(true)
          lastLoadedGroupIdRef.current = activeGroupId
        }
      }
    }

    loadState()

    return () => {
      isCancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- profileDisplayName only affects labels (labelForParticipant); omit to avoid reloading shared state
  }, [session?.user?.id, activeGroupId, groupRole, pruneInvalidParticipantReferences, applyPersistedState])

  // Save shared state (owners/admins) for the active group.
  useEffect(() => {
    if (isInitialLoad.current) return
    if (!activeGroupId || !groupRole) return
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false
      return
    }

    const sharedState = {
      version: STATE_VERSION,
      selectedGamemode,
      selectedMapId,
      selectedWeather,
      selectedLoadoutRandomTarget,
      lockedGamemode,
      lockedMap,
      lockedWeather,
      lockedLoadoutRandomTarget,
      participants,
      teamAssignments,
      lockedParticipants,
      balancedTeams,
      fillFirst,
      keepSeparatePairs,
      loadouts,
      lockedLoadouts,
      classInputs,
      classEnabled,
      specializationInputs,
      specializationEnabled,
      weaponInputs,
      weaponEnabled,
      gadgetInputs,
      gadgetEnabled,
      playerOverrides
    }

    const canWriteShared = groupRole === 'owner' || groupRole === 'admin'
    const sharedSer = stableSerialize(sharedState)

    if (canWriteShared && sharedSer !== lastGroupPersistedRef.current) {
      saveGroupPersistedState(activeGroupId, sharedState)
        .then(() => {
          lastGroupPersistedRef.current = sharedSer
        })
        .catch((error) => {
          console.error('[State] Error saving group persisted state:', error)
        })
    }

  }, [
    groupRole,
    activeGroupId,
    selectedGamemode,
    selectedMapId,
    selectedWeather,
    selectedLoadoutRandomTarget,
    lockedGamemode,
    lockedMap,
    lockedWeather,
    lockedLoadoutRandomTarget,
    participants,
    teamAssignments,
    lockedParticipants,
    balancedTeams,
    fillFirst,
    keepSeparatePairs,
    loadouts,
    lockedLoadouts,
    classInputs,
    classEnabled,
    specializationInputs,
    specializationEnabled,
    weaponInputs,
    weaponEnabled,
    gadgetInputs,
    gadgetEnabled,
    playerOverrides
  ])

  useEffect(() => {
    if (!supabase || !session?.user?.id || !activeGroupId) return

    const userId = session.user.id
    let isMounted = true
    const unsubscribe = subscribeToGroupLoadoutChanges(supabase, activeGroupId, async () => {
      if (!isMounted) return
      try {
        const [latest, memberRows] = await Promise.all([
          fetchGroupPersistedState(activeGroupId),
          fetchGroupMembers(activeGroupId)
        ])
        if (!isMounted) return

        const orderedRows = orderGroupMemberRows(memberRows, userId)
        const memberIds = orderedRows.map((r) => r.user_id)
        setGroupMemberLabels(buildGroupMemberLabelMap(orderedRows, userId, profileDisplayName))
        setGroupMemberRoster(orderedRows)
        setParticipants(memberIds)
        pruneInvalidParticipantReferences(memberIds)

        if (!latest || latest.version !== STATE_VERSION) return

        const serializedLatest = stableSerialize(latest)
        if (serializedLatest === lastGroupPersistedRef.current) return

        lastGroupPersistedRef.current = serializedLatest
        skipNextPersistRef.current = true
        applyPersistedState(latest)
        pruneInvalidParticipantReferences(memberIds)
      } catch (error) {
        console.error('[Realtime] Failed to sync state update:', error)
      }
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- profileDisplayName only for member label map; omit to avoid effect churn
  }, [session?.user?.id, activeGroupId, pruneInvalidParticipantReferences, applyPersistedState])

  useEffect(() => {
    if (!supabase || !session?.user?.id || !activeGroupId) return

    const userId = session.user.id
    let isMounted = true
    const unsubscribe = subscribeToGroupMembershipChanges(supabase, activeGroupId, async () => {
      if (!isMounted) return
      try {
        const memberRows = await fetchGroupMembers(activeGroupId)
        if (!isMounted) return
        const orderedRows = orderGroupMemberRows(memberRows, userId)
        const memberIds = orderedRows.map((r) => r.user_id)
        setGroupMemberLabels(buildGroupMemberLabelMap(orderedRows, userId, profileDisplayName))
        setGroupMemberRoster(orderedRows)
        setParticipants(memberIds)
        pruneInvalidParticipantReferences(memberIds)
        setGroupMembersError('')
      } catch (error) {
        console.error('[Realtime] Failed to sync membership update:', error)
        if (isMounted) setGroupMembersError(error.message || 'Failed to load group members.')
      }
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- profileDisplayName only for member label map; omit to avoid effect churn
  }, [session?.user?.id, activeGroupId, pruneInvalidParticipantReferences])

  useEffect(() => {
    if (!supabase || !session?.user?.id || !activeGroupId) return

    const userId = session.user.id
    let isMounted = true
    const unsubscribe = subscribeToGroupAvailabilityChanges(supabase, activeGroupId, async (payload) => {
      if (!isMounted) return
      try {
        const changedUserId = payload?.new?.user_id || payload?.old?.user_id
        if (changedUserId) {
          const nextStatus =
            payload?.eventType === 'DELETE'
              ? 'available'
              : normalizeGroupManualStatus(payload?.new?.manual_status)
          setGroupMemberRoster((prev) =>
            prev.map((row) =>
              row.user_id === changedUserId ? { ...row, manual_status: nextStatus } : row
            )
          )
        }
        const memberRows = await fetchGroupMembers(activeGroupId)
        if (!isMounted) return
        const orderedRows = orderGroupMemberRows(memberRows, userId)
        const memberIds = orderedRows.map((r) => r.user_id)
        setGroupMemberLabels(buildGroupMemberLabelMap(orderedRows, userId, profileDisplayName))
        setGroupMemberRoster(orderedRows)
        setParticipants(memberIds)
      } catch (error) {
        console.error('[Realtime] Failed to sync availability update:', error)
      }
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- profileDisplayName only for member label map; omit to avoid effect churn
  }, [session?.user?.id, activeGroupId])

  useEffect(() => {
    if (!supabase || !session?.user?.id || !activeGroupId) {
      setOnlineUserIds([])
      return
    }

    const userId = session.user.id
    const channel = supabase.channel(`group-presence-${activeGroupId}`, {
      config: { presence: { key: userId } }
    })

    const syncOnline = () => {
      setOnlineUserIds(Object.keys(channel.presenceState()))
    }

    channel
      .on('presence', { event: 'sync' }, syncOnline)
      .on('presence', { event: 'join' }, syncOnline)
      .on('presence', { event: 'leave' }, syncOnline)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ joined_at: new Date().toISOString() })
        }
      })

    return () => {
      setOnlineUserIds([])
      supabase.removeChannel(channel)
    }
  }, [session?.user?.id, activeGroupId])

  useEffect(() => {
    const updateSidebarMode = () => {
      const currentWidth = window.innerWidth
      setViewportWidth(currentWidth)
      setIsSidebarOverlayMode(currentWidth < SIDEBAR_OVERLAY_BREAKPOINT)
    }

    updateSidebarMode()
    window.addEventListener('resize', updateSidebarMode)
    return () => window.removeEventListener('resize', updateSidebarMode)
  }, [])

  useEffect(() => {
    if (!useMobilePanelTabs) {
      setMobilePanelTab('game-options')
    }
  }, [useMobilePanelTabs])

  useLayoutEffect(() => {
    // Sidebar default state is width-driven only (not persisted):
    // open at >= 800px, closed below 800px.
    setIsSidebarCollapsed(viewportWidth < SIDEBAR_COLLAPSE_DEFAULT_BREAKPOINT)
  }, [viewportWidth])

  useLayoutEffect(() => {
    const listEl = participantsListRef.current
    if (!listEl) return

    const updateOverflowState = () => {
      const hasOverflow = listEl.scrollHeight > listEl.clientHeight + 1
      setParticipantsListHasOverflow((prev) => (prev === hasOverflow ? prev : hasOverflow))
    }

    updateOverflowState()

    let observer = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateOverflowState)
      observer.observe(listEl)
    }

    window.addEventListener('resize', updateOverflowState)
    return () => {
      if (observer) observer.disconnect()
      window.removeEventListener('resize', updateOverflowState)
    }
  }, [participants, groupMemberRoster, groupMembersReady, groupMembersError])

  useEffect(() => {
    // On narrow dashboard screens, sidebar starts closed by default.
    if (isDashboardSidebarOverlayMode) {
      setIsDashboardSidebarCollapsed(true)
    }
  }, [isDashboardSidebarOverlayMode])

  useEffect(() => {
    if (!isViewOnlyMode) return
    setIsSettingsModalOpen(false)
    setIsUserSettingsModalOpen(false)
    setIsTeamSettingsModalOpen(false)
    setLoadoutSelector(null)
  }, [isViewOnlyMode])

  const syncGroupInUrl = (groupId) => {
    const url = new URL(window.location.href)
    if (groupId) url.searchParams.set('group', groupId)
    else url.searchParams.delete('group')
    window.history.replaceState({}, '', `${url.pathname}${url.search}`)
  }

  const openGroup = (g) => {
    setActiveGroupId(g.id)
    setGroupRole(g.role)
    syncGroupInUrl(g.id)
    setGroupsLoadError('')
  }

  const backToGroupsDashboard = () => {
    setActiveGroupId(null)
    setGroupRole(null)
    setIsProfileMenuOpen(false)
    syncGroupInUrl(null)
  }

  const handleJoinGroup = async () => {
    const code = joinCodeInput.trim()
    if (!code || !session?.user || !supabase) return
    setJoinBusy(true)
    setGroupsLoadError('')
    try {
      const gid = await joinGroupByCode(code)
      const list = await fetchMyGroups(session.user.id)
      setMyGroups(list)
      const row = list.find((x) => x.id === gid)
      if (row) openGroup(row)
      else setGroupsLoadError('Joined, but could not open the group. Refresh the page.')
      setJoinCodeInput('')
    } catch (err) {
      setGroupsLoadError(err.message || 'Could not join that group.')
    } finally {
      setJoinBusy(false)
    }
  }

  const handleCreateGroup = async () => {
    const name = newGroupName.trim()
    if (!name || !session?.user || !supabase) return
    setCreateGroupBusy(true)
    setGroupsLoadError('')
    try {
      const gid = await createGroup(name)
      const list = await fetchMyGroups(session.user.id)
      setMyGroups(list)
      const row = list.find((x) => x.id === gid)
      if (row) openGroup(row)
      else setGroupsLoadError('Created, but could not open the group. Refresh the page.')
      setNewGroupName('')
      setCreateGroupModalOpen(false)
    } catch (err) {
      setGroupsLoadError(err.message || 'Could not create that group.')
    } finally {
      setCreateGroupBusy(false)
    }
  }

  const handleSignOut = async () => {
    try {
      setIsProfileMenuOpen(false)
      setIsUserSettingsModalOpen(false)
      await authSignOut()
      const url = new URL(window.location.href)
      url.searchParams.delete('group')
      window.history.replaceState({}, '', `${url.pathname}${url.search}`)
      navigate('/login', { replace: true })
    } catch (err) {
      console.error('[Auth] Sign out failed:', err)
    }
  }

  const handleOpenUserSettings = () => {
    setIsProfileMenuOpen(false)
    setIsUserSettingsModalOpen(true)
  }

  const handleRefreshProfilePicture = async () => {
    if (!supabase || !session?.user?.id || refreshProfilePictureBusy) return
    setRefreshProfilePictureBusy(true)
    try {
      const {
        data: { user },
        error
      } = await supabase.auth.getUser()
      if (error) throw error
      const metadata = user?.user_metadata || {}
      const discordUserId = String(metadata.provider_id || '').trim()
      const discordAvatarHash = String(metadata.avatar || '').trim()
      const discordAvatarUrl = buildDiscordAvatarUrl(discordUserId, discordAvatarHash)
      const fallbackAvatarUrl = normalizeAvatarUrl(metadata.avatar_url || metadata.picture)
      const resolvedAvatarUrl = discordAvatarUrl || fallbackAvatarUrl || null

      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          avatar_url: resolvedAvatarUrl,
          discord_user_id: discordUserId || null,
          discord_avatar_hash: discordAvatarHash || null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', session.user.id)
      if (updateError) throw updateError
      await loadSelfProfile()
      setIsProfileMenuOpen(false)
    } catch (err) {
      console.error('[Profile] Could not refresh profile picture:', err)
    } finally {
      setRefreshProfilePictureBusy(false)
    }
  }

  useEffect(() => {
    // Initialize team assignments when gamemode changes
    // Only do this if teamAssignments don't already exist for this gamemode
    if (selectedGamemode) {
      const mode = gameConfig.gamemodes[selectedGamemode]
      const teams = mode.teams
      
      // Check if we need to initialize or reset teams
      const needsInit = !teamAssignments || Object.keys(teamAssignments).length === 0 || 
        Object.keys(teamAssignments).length !== teams ||
        Object.keys(teamAssignments).some(teamIndex => 
          teamAssignments[teamIndex] && teamAssignments[teamIndex].length > mode.players_per_team
        )
      
      if (needsInit) {
        const initialAssignments = {}
        for (let i = 0; i < teams; i++) {
          // Try to preserve existing assignments if team count matches
          initialAssignments[i] = teamAssignments[i]?.slice(0, mode.players_per_team) || []
        }
        setTeamAssignments(initialAssignments)
        
        // Clear locks for participants no longer in valid teams/slots
        const validLocks = {}
        Object.keys(lockedParticipants).forEach(participant => {
          const lockedTeam = lockedParticipants[participant]
          if (lockedTeam < teams && initialAssignments[lockedTeam]?.includes(participant)) {
            validLocks[participant] = lockedTeam
          }
        })
        if (Object.keys(validLocks).length !== Object.keys(lockedParticipants).length) {
          setLockedParticipants(validLocks)
        }
      }
    }
    // Intentionally depends only on gamemode; teamAssignments/lockedParticipants are read for init logic only.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid reset loops when assignments update
  }, [selectedGamemode, activeGroupId, groupRole])

  useEffect(() => {
    if (!isProfileMenuOpen) return

    const handlePointerDown = (event) => {
      const target = event.target
      if (profileMenuRef.current?.contains(target)) return
      if (profileMenuButtonRef.current?.contains(target)) return
      setIsProfileMenuOpen(false)
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') setIsProfileMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isProfileMenuOpen])

  useEffect(() => {
    const isAnyModalOpen =
      isSettingsModalOpen ||
      isUserSettingsModalOpen ||
      isTeamSettingsModalOpen ||
      createGroupModalOpen ||
      !!loadoutSelector

    if (!isAnyModalOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isSettingsModalOpen, isUserSettingsModalOpen, isTeamSettingsModalOpen, createGroupModalOpen, loadoutSelector])

  useEffect(() => {
    setPlayerOverrides(prev => {
      const participantSet = new Set(participants)
      const filtered = Object.fromEntries(
        Object.entries(prev).filter(([name]) => participantSet.has(name))
      )
      return Object.keys(filtered).length === Object.keys(prev).length ? prev : filtered
    })

    if (
      settingsTargetPlayer !== SETTINGS_ALL_PLAYERS &&
      !participants.includes(settingsTargetPlayer)
    ) {
      setSettingsTargetPlayer(SETTINGS_ALL_PLAYERS)
    }

    setKeepSeparatePairs(prev =>
      prev.filter(
        (pair) =>
          participants.includes(pair.playerA) &&
          participants.includes(pair.playerB) &&
          pair.playerA !== pair.playerB
      )
    )

    if (!keepSeparateA || !participants.includes(keepSeparateA)) {
      setKeepSeparateA(participants[0] || '')
    }
    if (!keepSeparateB || !participants.includes(keepSeparateB)) {
      const fallback = participants.find((name) => name !== (participants[0] || '')) || participants[0] || ''
      setKeepSeparateB(fallback)
    }
    // keepSeparateA/B are updated here; listing them as deps would retrigger this effect unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync pair inputs when participant list changes
  }, [participants, settingsTargetPlayer])

  useEffect(() => {
    if (participants.length < 2) return
    if (!keepSeparateB || keepSeparateB === keepSeparateA || !participants.includes(keepSeparateB)) {
      const fallback = participants.find((name) => name !== keepSeparateA) || ''
      setKeepSeparateB(fallback)
    }
  }, [keepSeparateA, keepSeparateB, participants])

  useLayoutEffect(() => {
    const panelEl = teamsPanelRef.current
    if (!panelEl) return
    let retryTimerId = null
    let zeroMeasureRetries = 0
    const MAX_ZERO_MEASURE_RETRIES = 8

    const updateOrientation = () => {
      const rect = panelEl.getBoundingClientRect()
      const measuredWidth = panelEl.clientWidth || Math.round(rect.width) || panelEl.offsetWidth || 0
      const measuredHeight = panelEl.clientHeight || Math.round(rect.height) || panelEl.offsetHeight || 0
      const width = Math.max(0, measuredWidth)
      const height = Math.max(0, measuredHeight)
      setIsTeamsPanelPortrait(height > width)
      setTeamsPanelWidth(width)
      setTeamsPanelHeight(height)
      if ((width === 0 || height === 0) && zeroMeasureRetries < MAX_ZERO_MEASURE_RETRIES) {
        zeroMeasureRetries += 1
        if (retryTimerId) clearTimeout(retryTimerId)
        retryTimerId = setTimeout(updateOrientation, 40 * zeroMeasureRetries)
      } else if (width > 0 && height > 0) {
        zeroMeasureRetries = 0
      }
    }

    updateOrientation()
    const raf1 = requestAnimationFrame(updateOrientation)
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(updateOrientation))
    const timeoutId = setTimeout(updateOrientation, 120)

    let observer = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => updateOrientation())
      observer.observe(panelEl)
    }

    window.addEventListener('resize', updateOrientation)
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      clearTimeout(timeoutId)
      if (retryTimerId) clearTimeout(retryTimerId)
      if (observer) observer.disconnect()
      window.removeEventListener('resize', updateOrientation)
    }
  }, [selectedGamemode, activeGroupId, groupRole, isSidebarCollapsed, isSidebarOverlayMode, layoutRefreshNonce])

  useEffect(() => {
    if (!import.meta.hot) return
    const onAfterUpdate = () => setLayoutRefreshNonce((prev) => prev + 1)
    import.meta.hot.on('vite:afterUpdate', onAfterUpdate)
    return () => {
      import.meta.hot.off?.('vite:afterUpdate', onAfterUpdate)
    }
  }, [])

  const handleAddKeepSeparatePair = () => {
    if (!keepSeparateA || !keepSeparateB || keepSeparateA === keepSeparateB) return

    const pairExists = keepSeparatePairs.some(
      (pair) =>
        (pair.playerA === keepSeparateA && pair.playerB === keepSeparateB) ||
        (pair.playerA === keepSeparateB && pair.playerB === keepSeparateA)
    )
    if (pairExists) return

    setKeepSeparatePairs((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        playerA: keepSeparateA,
        playerB: keepSeparateB
      }
    ])
  }

  const handleRemoveKeepSeparatePair = (id) => {
    setKeepSeparatePairs((prev) => prev.filter((pair) => pair.id !== id))
  }

  const handleAssignToTeam = (participant, teamIndex) => {
    if (isParticipantUnavailableForTeams(participant)) return
    const mode = gameConfig.gamemodes[selectedGamemode]
    const maxPerTeam = mode.players_per_team
    
    // Check if team is full
    if (teamAssignments[teamIndex]?.length >= maxPerTeam) {
      return
    }

    // Remove participant from all teams first
    const updatedAssignments = { ...teamAssignments }
    Object.keys(updatedAssignments).forEach(ti => {
      updatedAssignments[ti] = updatedAssignments[ti].filter(p => p !== participant)
    })

    // Add to selected team
    updatedAssignments[teamIndex] = [...(updatedAssignments[teamIndex] || []), participant]
    setTeamAssignments(updatedAssignments)
  }

  const handleSendBackToParticipants = (participant, teamIndex) => {
    if (lockedParticipants[participant] === teamIndex) return
    const updatedAssignments = { ...teamAssignments }
    updatedAssignments[teamIndex] = (updatedAssignments[teamIndex] || []).filter((p) => p !== participant)
    setTeamAssignments(updatedAssignments)
    // Clear team lock when sending back to participant pool
    const updatedLocks = { ...lockedParticipants }
    delete updatedLocks[participant]
    setLockedParticipants(updatedLocks)
  }

  const handleParticipantPoolDragStart = (e, participantId) => {
    if (e.target instanceof Element && e.target.closest('.participant-item__actions-wrap')) {
      e.preventDefault()
      return
    }
    if (isParticipantUnavailableForTeams(participantId)) {
      e.preventDefault()
      return
    }
    beginTeamDrag(e, { participant: participantId, fromTeam: null, fromSlot: null })
  }

  const handleTeamPlayerDragStart = (e, participantId, teamIndex, slotIndex) => {
    if (
      e.target instanceof Element &&
      (e.target.closest('.player-actions') || e.target.closest('.assigned-slot-actions-wrap'))
    ) {
      e.preventDefault()
      return
    }
    if (isParticipantUnavailableForTeams(participantId)) {
      e.preventDefault()
      return
    }
    if (lockedParticipants[participantId] === teamIndex) {
      e.preventDefault()
      return
    }
    beginTeamDrag(e, { participant: participantId, fromTeam: teamIndex, fromSlot: slotIndex })
  }

  const handleTeamSlotDragOver = (e, targetTeamIndex, targetSlotIndex, assignedPlayer) => {
    if (isViewOnlyMode) return
    e.preventDefault()
    const active = teamDnDRef.current
    if (!active) {
      e.dataTransfer.dropEffect = 'none'
      return
    }
    if (isParticipantUnavailableForTeams(active.participant)) {
      e.dataTransfer.dropEffect = 'none'
      return
    }
    const mode = selectedGamemode ? gameConfig.gamemodes[selectedGamemode] : null
    if (!mode) {
      e.dataTransfer.dropEffect = 'none'
      return
    }
    const outcome = previewTeamDragDrop({
      assignments: teamAssignments,
      lockedParticipants,
      participant: active.participant,
      fromTeam: active.fromTeam,
      fromSlot: active.fromSlot,
      targetTeamIndex,
      targetSlotIndex,
      targetOccupant: assignedPlayer || null,
      maxPerTeam: mode.players_per_team
    })
    setTeamDnDHover((prev) =>
      prev?.teamIndex === targetTeamIndex && prev?.slotIndex === targetSlotIndex
        ? prev
        : { teamIndex: targetTeamIndex, slotIndex: targetSlotIndex }
    )
    e.dataTransfer.dropEffect = outcome === 'invalid' ? 'none' : 'move'
  }

  const handleTeamSlotDragLeave = (e, targetTeamIndex, targetSlotIndex) => {
    const nextTarget = e.relatedTarget
    const slotsRow = e.currentTarget.closest?.('.team-slots')
    if (nextTarget && slotsRow?.contains(nextTarget)) return
    setTeamDnDHover((prev) =>
      prev?.teamIndex === targetTeamIndex && prev?.slotIndex === targetSlotIndex ? null : prev
    )
  }

  const handleTeamBlockDragOver = (e, teamIndex) => {
    if (isViewOnlyMode) return
    const active = teamDnDRef.current
    if (!active) return
    if (isParticipantUnavailableForTeams(active.participant)) {
      e.dataTransfer.dropEffect = 'none'
      return
    }
    if (e.target.closest?.('.team-slot')) return
    e.preventDefault()
    const mode = selectedGamemode ? gameConfig.gamemodes[selectedGamemode] : null
    if (!mode) {
      e.dataTransfer.dropEffect = 'none'
      return
    }
    const assignForPlace = removeParticipantFromAssignments(teamAssignments, active.participant)
    const placeIdx = firstEmptySlotIndex(
      assignForPlace[teamIndex] || [],
      mode.players_per_team
    )
    const outcome =
      placeIdx < 0
        ? 'invalid'
        : previewTeamDragDrop({
            assignments: teamAssignments,
            lockedParticipants,
            participant: active.participant,
            fromTeam: active.fromTeam,
            fromSlot: active.fromSlot,
            targetTeamIndex: teamIndex,
            targetSlotIndex: placeIdx,
            targetOccupant: null,
            maxPerTeam: mode.players_per_team
          })
    setTeamDnDHover((prev) =>
      prev?.teamIndex === teamIndex && prev?.slotIndex == null ? prev : { teamIndex, slotIndex: null }
    )
    e.dataTransfer.dropEffect = outcome === 'invalid' ? 'none' : 'move'
  }

  const handleTeamBlockDragLeave = (e, teamIndex) => {
    const nextTarget = e.relatedTarget
    if (nextTarget && e.currentTarget.contains(nextTarget)) return
    setTeamDnDHover((prev) =>
      prev?.teamIndex === teamIndex && prev?.slotIndex == null ? null : prev
    )
  }

  const handleTeamBlockDrop = (e, teamIndex) => {
    if (isViewOnlyMode) return
    if (e.target.closest?.('.team-slot')) return
    e.preventDefault()
    e.stopPropagation()
    endTeamDnD()
    const mode = selectedGamemode ? gameConfig.gamemodes[selectedGamemode] : null
    if (!mode) return
    const parsed = parseTeamDragTransfer(e.dataTransfer)
    if (!parsed) return
    if (isParticipantUnavailableForTeams(parsed.participant)) return
    const assignForPlace = removeParticipantFromAssignments(teamAssignments, parsed.participant)
    const placeIdx = firstEmptySlotIndex(
      assignForPlace[teamIndex] || [],
      mode.players_per_team
    )
    if (placeIdx < 0) return
    const next = applyTeamDragDrop({
      assignments: teamAssignments,
      lockedParticipants,
      participant: parsed.participant,
      fromTeam: parsed.fromTeam,
      fromSlot: parsed.fromSlot,
      targetTeamIndex: teamIndex,
      targetSlotIndex: placeIdx,
      targetOccupant: null,
      maxPerTeam: mode.players_per_team
    })
    if (next) setTeamAssignments(next)
  }

  const handleTeamSlotDrop = (e, targetTeamIndex, targetSlotIndex, assignedPlayer) => {
    if (isViewOnlyMode) return
    e.preventDefault()
    e.stopPropagation()
    endTeamDnD()
    const mode = selectedGamemode ? gameConfig.gamemodes[selectedGamemode] : null
    if (!mode) return
    const parsed = parseTeamDragTransfer(e.dataTransfer)
    if (!parsed) return
    if (isParticipantUnavailableForTeams(parsed.participant)) return
    const next = applyTeamDragDrop({
      assignments: teamAssignments,
      lockedParticipants,
      participant: parsed.participant,
      fromTeam: parsed.fromTeam,
      fromSlot: parsed.fromSlot,
      targetTeamIndex,
      targetSlotIndex,
      targetOccupant: assignedPlayer || null,
      maxPerTeam: mode.players_per_team
    })
    if (next) setTeamAssignments(next)
  }

  const isParticipantsListTeamUnassignDrop = (active) => {
    if (!active || active.fromTeam == null) return false
    if (lockedParticipants[active.participant] === active.fromTeam) return false
    return true
  }

  const handleParticipantsListDragOver = (e) => {
    if (isViewOnlyMode) return
    const active = teamDnDRef.current
    const valid = isParticipantsListTeamUnassignDrop(active)
    if (!valid) {
      e.dataTransfer.dropEffect = 'none'
      setParticipantsDropHover(false)
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setParticipantsDropHover(true)
  }

  const handleParticipantsListDragLeave = (e) => {
    const nextTarget = e.relatedTarget
    if (nextTarget && e.currentTarget.contains(nextTarget)) return
    setParticipantsDropHover(false)
  }

  const handleParticipantsListDrop = (e) => {
    if (isViewOnlyMode) return
    e.preventDefault()
    e.stopPropagation()
    endTeamDnD()
    const parsed = parseTeamDragTransfer(e.dataTransfer)
    if (!parsed || parsed.fromTeam == null) return
    handleSendBackToParticipants(parsed.participant, parsed.fromTeam)
  }

  const toggleParticipantPositionLock = (participant, teamIndex) => {
    setLockedParticipants((prev) => {
      const updatedLocks = { ...prev }
      if (updatedLocks[participant] === teamIndex) {
        delete updatedLocks[participant]
      } else {
        updatedLocks[participant] = teamIndex
      }
      return updatedLocks
    })
  }

  // Fisher-Yates shuffle algorithm
  const shuffleArray = (array) => {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }

  const buildRandomizedTeamResult = (gamemodeKey) => {
    if (!gamemodeKey || participants.length === 0) return null

    const mode = gameConfig.gamemodes[gamemodeKey]
    const numTeams = mode.teams
    const playersPerTeam = mode.players_per_team

    const activeKeepSeparatePairs = keepSeparatePairs.filter(
      (pair) =>
        participants.includes(pair.playerA) &&
        participants.includes(pair.playerB) &&
        pair.playerA !== pair.playerB
    )

    const conflictMap = {}
    activeKeepSeparatePairs.forEach((pair) => {
      if (!conflictMap[pair.playerA]) conflictMap[pair.playerA] = new Set()
      if (!conflictMap[pair.playerB]) conflictMap[pair.playerB] = new Set()
      conflictMap[pair.playerA].add(pair.playerB)
      conflictMap[pair.playerB].add(pair.playerA)
    })

    const teamHasConflict = (teamIndex, participant, assignments) => {
      const conflicts = conflictMap[participant]
      if (!conflicts) return false
      return (assignments[teamIndex] || []).some((member) => member && conflicts.has(member))
    }

    // Initialize teams with locked participants in their current slots
    const newAssignments = {}
    const teamSlotsUsed = {}
    for (let i = 0; i < numTeams; i++) {
      newAssignments[i] = []
      teamSlotsUsed[i] = 0
    }

    // First, place locked participants in their current positions
    Object.keys(lockedParticipants).forEach(participant => {
      if (isParticipantUnavailableForTeams(participant)) return
      const lockedTeamIndex = lockedParticipants[participant]
      if (teamSlotsUsed[lockedTeamIndex] < playersPerTeam) {
        // Find their current slot position to maintain it if possible
        const currentSlot = teamAssignments[lockedTeamIndex]?.indexOf(participant)
        if (currentSlot !== undefined && currentSlot !== -1) {
          // Maintain their position
          while (newAssignments[lockedTeamIndex].length < currentSlot) {
            newAssignments[lockedTeamIndex].push(null)
          }
          newAssignments[lockedTeamIndex][currentSlot] = participant
        } else {
          newAssignments[lockedTeamIndex].push(participant)
        }
        teamSlotsUsed[lockedTeamIndex]++
      }
    })

    // Fill null slots (placeholders for locked positions) and collect unlocked participants
    const unlockedParticipants = participants.filter(
      (p) => lockedParticipants[p] === undefined && !isParticipantUnavailableForTeams(p)
    )
    const shuffledUnlocked = shuffleArray(unlockedParticipants)

    // Calculate minimum teams needed if fillFirst is enabled
    const minTeamsNeeded = fillFirst ? Math.ceil(unlockedParticipants.length / playersPerTeam) : numTeams
    const teamsToUse = Math.min(minTeamsNeeded, numTeams)

    // Fill teams with unlocked participants
    if (balancedTeams) {
      // Balanced: round-robin; retry passes avoid avoidable keep-separate violations
      for (let slotIndex = 0; slotIndex < playersPerTeam; slotIndex++) {
        if (shuffledUnlocked.length === 0) break
        let progress = true
        while (progress && shuffledUnlocked.length > 0) {
          progress = false
          for (let teamIndex = 0; teamIndex < teamsToUse; teamIndex++) {
            if (teamSlotsUsed[teamIndex] >= playersPerTeam) continue
            if (newAssignments[teamIndex][slotIndex]) continue

            const pickIndex = shuffledUnlocked.findIndex(
              (participant) => !teamHasConflict(teamIndex, participant, newAssignments)
            )
            if (pickIndex === -1) continue

            const pickedParticipant = shuffledUnlocked.splice(pickIndex, 1)[0]
            if (!pickedParticipant) continue
            newAssignments[teamIndex][slotIndex] = pickedParticipant
            teamSlotsUsed[teamIndex]++
            progress = true
          }
        }
        for (let teamIndex = 0; teamIndex < teamsToUse; teamIndex++) {
          if (teamSlotsUsed[teamIndex] >= playersPerTeam) continue
          if (newAssignments[teamIndex][slotIndex]) continue
          if (shuffledUnlocked.length === 0) break

          let pickIndex = shuffledUnlocked.findIndex(
            (participant) => !teamHasConflict(teamIndex, participant, newAssignments)
          )
          if (pickIndex === -1) pickIndex = 0
          const pickedParticipant = shuffledUnlocked.splice(pickIndex, 1)[0]
          if (!pickedParticipant) continue
          newAssignments[teamIndex][slotIndex] = pickedParticipant
          teamSlotsUsed[teamIndex]++
        }
      }
    } else {
      // Unbalanced: multi-pass placement prefers conflict-free teams before forcing
      let queue = [...shuffledUnlocked]
      let safety = 0
      while (queue.length > 0 && safety < participants.length * 4 + 8) {
        safety += 1
        const nextQueue = []
        let placedAny = false
        for (const participant of queue) {
          const teamsWithSpace = []
          const conflictFreeTeams = []

          for (let teamIndex = 0; teamIndex < teamsToUse; teamIndex++) {
            if (teamSlotsUsed[teamIndex] >= playersPerTeam) continue
            teamsWithSpace.push(teamIndex)
            if (!teamHasConflict(teamIndex, participant, newAssignments)) {
              conflictFreeTeams.push(teamIndex)
            }
          }

          if (conflictFreeTeams.length > 0) {
            const randomTeamIndex =
              conflictFreeTeams[Math.floor(Math.random() * conflictFreeTeams.length)]
            newAssignments[randomTeamIndex].push(participant)
            teamSlotsUsed[randomTeamIndex]++
            placedAny = true
          } else if (teamsWithSpace.length > 0) {
            nextQueue.push(participant)
          }
        }
        queue = placedAny ? shuffleArray(nextQueue) : nextQueue
        if (!placedAny) break
      }

      queue.forEach((participant) => {
        const teamsWithSpace = []
        for (let teamIndex = 0; teamIndex < teamsToUse; teamIndex++) {
          if (teamSlotsUsed[teamIndex] < playersPerTeam) teamsWithSpace.push(teamIndex)
        }
        if (teamsWithSpace.length === 0) return
        const randomTeamIndex = teamsWithSpace[Math.floor(Math.random() * teamsWithSpace.length)]
        newAssignments[randomTeamIndex].push(participant)
        teamSlotsUsed[randomTeamIndex]++
      })

      // If everyone landed on one team, move one player to another when possible
      const teamsWithPlayers = Object.keys(newAssignments).filter(
        (teamIndex) => newAssignments[teamIndex] && newAssignments[teamIndex].length > 0
      )

      if (teamsWithPlayers.length === 1) {
        const teamWithAllPlayers = parseInt(teamsWithPlayers[0], 10)
        const members = newAssignments[teamWithAllPlayers]
        if (members.length > 1) {
          const lastPlayer = members.pop()
          teamSlotsUsed[teamWithAllPlayers]--

          const candidates = []
          for (let i = 0; i < teamsToUse; i++) {
            if (i !== teamWithAllPlayers && teamSlotsUsed[i] < playersPerTeam) {
              candidates.push(i)
            }
          }

          let moved = false
          for (const i of candidates) {
            if (!teamHasConflict(i, lastPlayer, newAssignments)) {
              newAssignments[i].push(lastPlayer)
              teamSlotsUsed[i]++
              moved = true
              break
            }
          }
          if (!moved) {
            for (const i of candidates) {
              newAssignments[i].push(lastPlayer)
              teamSlotsUsed[i]++
              moved = true
              break
            }
          }
          if (!moved) {
            newAssignments[teamWithAllPlayers].push(lastPlayer)
            teamSlotsUsed[teamWithAllPlayers]++
          }
        }
      }
    }

    // Clean up: remove nulls and ensure arrays are proper length
    for (let i = 0; i < numTeams; i++) {
      newAssignments[i] = newAssignments[i].filter(p => p !== null)
      // Ensure we don't exceed max per team
      if (newAssignments[i].length > playersPerTeam) {
        newAssignments[i] = newAssignments[i].slice(0, playersPerTeam)
      }
    }

    // Compact teams: move non-empty teams to the front
    const compactedAssignments = {}
    const teamMapping = {} // Maps old team index to new team index
    let compactIndex = 0
    const updatedLocks = {}

    // First, add all non-empty teams
    for (let i = 0; i < numTeams; i++) {
      if (newAssignments[i] && newAssignments[i].length > 0) {
        compactedAssignments[compactIndex] = newAssignments[i]
        teamMapping[i] = compactIndex
        compactIndex++
      }
    }

    // Then add empty teams at the end
    for (let i = 0; i < numTeams; i++) {
      if (newAssignments[i] && newAssignments[i].length === 0) {
        compactedAssignments[compactIndex] = []
        teamMapping[i] = compactIndex
        compactIndex++
      }
    }

    // Update locked participants to reflect new team indices
    Object.keys(lockedParticipants).forEach(participant => {
      const oldTeamIndex = lockedParticipants[participant]
      if (teamMapping[oldTeamIndex] !== undefined) {
        updatedLocks[participant] = teamMapping[oldTeamIndex]
      }
    })

    return { compactedAssignments, updatedLocks }
  }

  const handleRandomizeTeams = () => {
    const result = buildRandomizedTeamResult(selectedGamemode)
    if (!result) return
    setTeamAssignments(result.compactedAssignments)
    setLockedParticipants(result.updatedLocks)
  }

  const handleToggleLoadoutLock = (participant, type, index = null) => {
    const updatedLocks = { ...lockedLoadouts }
    if (!updatedLocks[participant]) {
      updatedLocks[participant] = {}
    }
    
    if (type === 'gadget' && index !== null) {
      if (!updatedLocks[participant].gadgets) {
        updatedLocks[participant].gadgets = [false, false, false]
      }
      updatedLocks[participant].gadgets[index] = !updatedLocks[participant].gadgets[index]
    } else {
      updatedLocks[participant][type] = !updatedLocks[participant][type]
    }
    
    setLockedLoadouts(updatedLocks)
  }

  const handleToggleAllLoadoutLocks = (participant) => {
    const updatedLocks = { ...lockedLoadouts }
    if (!updatedLocks[participant]) {
      updatedLocks[participant] = {}
    }
    
    const locks = updatedLocks[participant]
    // Check if all items are locked
    const classLocked = locks.class === true
    const specLocked = locks.specialization === true
    const weaponLocked = locks.weapon === true
    const gadgetsLocked = locks.gadgets?.every(locked => locked === true) || false
    
    const allLocked = classLocked && specLocked && weaponLocked && gadgetsLocked
    
    // If all are locked, unlock all. Otherwise, lock all.
    if (allLocked) {
      updatedLocks[participant] = {
        class: false,
        specialization: false,
        weapon: false,
        gadgets: [false, false, false]
      }
    } else {
      updatedLocks[participant] = {
        class: true,
        specialization: true,
        weapon: true,
        gadgets: [true, true, true]
      }
    }
    
    setLockedLoadouts(updatedLocks)
  }

  const handleClearPlayerLoadout = (participant) => {
    if (!participant) return
    setLoadouts((prev) => ({
      ...prev,
      [participant]: { class: null, specialization: null, weapon: null, gadgets: [null, null, null] }
    }))
  }

  const handleSwapPlayerLoadouts = (participantA, participantB) => {
    if (!participantA || !participantB || participantA === participantB) return
    const cloneValue = (v) => {
      if (v === undefined || v === null) return null
      return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))
    }
    setLoadouts((prev) => {
      const empty = { class: null, specialization: null, weapon: null, gadgets: [null, null, null] }
      const la = prev[participantA] != null ? cloneValue(prev[participantA]) : { ...empty }
      const lb = prev[participantB] != null ? cloneValue(prev[participantB]) : { ...empty }
      return { ...prev, [participantA]: lb, [participantB]: la }
    })
    setLockedLoadouts((prev) => {
      const next = { ...prev }
      const lockA = prev[participantA]
      const lockB = prev[participantB]
      if (lockB === undefined) delete next[participantA]
      else next[participantA] = cloneValue(lockB)
      if (lockA === undefined) delete next[participantB]
      else next[participantB] = cloneValue(lockA)
      return next
    })
  }

  const handleLoadoutSelect = (item) => {
    if (!loadoutSelector) return
    
    const { participant, type, index } = loadoutSelector
    const updatedLoadouts = { ...loadouts }
    
    if (!updatedLoadouts[participant]) {
      updatedLoadouts[participant] = { class: null, specialization: null, weapon: null, gadgets: [null, null, null] }
    }
    
    const locks = lockedLoadouts[participant] || {}
    
    if (type === 'class') {
      const oldClass = updatedLoadouts[participant].class
      updatedLoadouts[participant].class = item
      
      // Only clear specialization, weapon, and gadgets if class actually changed (unless locked)
      if (oldClass !== item) {
        if (!locks.specialization) {
          updatedLoadouts[participant].specialization = null
        }
        if (!locks.weapon) {
          updatedLoadouts[participant].weapon = null
        }
        // Handle gadgets - keep locked ones, clear unlocked ones
        if (!locks.gadgets) {
          updatedLoadouts[participant].gadgets = [null, null, null]
        } else {
          updatedLoadouts[participant].gadgets = (updatedLoadouts[participant].gadgets || [null, null, null]).map((g, i) => 
            locks.gadgets[i] ? g : null
          )
        }
      }
    } else if (type === 'specialization') {
      updatedLoadouts[participant].specialization = item
    } else if (type === 'weapon') {
      updatedLoadouts[participant].weapon = item
    } else if (type === 'gadget' && index !== null) {
      if (!updatedLoadouts[participant].gadgets) {
        updatedLoadouts[participant].gadgets = [null, null, null]
      }
      updatedLoadouts[participant].gadgets[index] = item
    }
    
    setLoadouts(updatedLoadouts)
    setLoadoutSelector(null)
  }

  const buildRandomizedLoadouts = (assignmentsSource, positionLocks) => {
    const allAssignedPlayers = Object.values(assignmentsSource).flat()
    if (allAssignedPlayers.length === 0 && participants.length === 0) return null

    const classNames = Object.keys(gameConfig.classes) // ['light', 'medium', 'heavy']
    const newLoadouts = { ...loadouts }

    const allPlayers = [...new Set([...allAssignedPlayers, ...participants])]

    allPlayers.forEach(participant => {
      if (positionLocks[participant] !== undefined) {
        return
      }

      if (!newLoadouts[participant]) {
        newLoadouts[participant] = { class: null, specialization: null, weapon: null, gadgets: [null, null, null] }
      }
      
      const locks = lockedLoadouts[participant] || {}
      const currentLoadout = newLoadouts[participant]
      
      // Check if any loadout item (except class) is locked
      const hasLockedItems = locks.specialization || locks.weapon || (locks.gadgets && locks.gadgets.some(locked => locked))
      
      // Randomly select a class (if not locked and no other items are locked)
      if (!locks.class && !hasLockedItems) {
        const availableClasses = classNames
          .filter(className => isClassEnabledForRandomizer(participant, className))
        currentLoadout.class = getWeightedRandomItem(
          availableClasses,
          (className) => getClassWeight(participant, className)
        )
        // Clear specialization, weapon, and gadgets if class changed (unless locked)
        if (!locks.specialization) currentLoadout.specialization = null
        if (!locks.weapon) currentLoadout.weapon = null
        if (!locks.gadgets) {
          currentLoadout.gadgets = [null, null, null]
        } else {
          // Only clear unlocked gadgets
          currentLoadout.gadgets = currentLoadout.gadgets.map((g, i) => locks.gadgets[i] ? g : null)
        }
      }
      
      const selectedClass = currentLoadout.class
      const classData = selectedClass ? gameConfig.classes[selectedClass] : null
      if (!classData) {
        if (!locks.specialization) currentLoadout.specialization = null
        if (!locks.weapon) currentLoadout.weapon = null
        if (!locks.gadgets) currentLoadout.gadgets = [null, null, null]
        return
      }

      // Randomly select a specialization (if not locked)
      if (!locks.specialization) {
        const specializations = (classData.specializations || [])
          .filter(spec => isSpecializationEnabledForRandomizer(participant, selectedClass, spec.name))
        currentLoadout.specialization = getWeightedRandomItem(
          specializations,
          (spec) => getSpecializationWeight(participant, selectedClass, spec.name)
        )
      }

      // Randomly select a weapon (if not locked)
      if (!locks.weapon) {
        const weapons = (classData.weapons || [])
          .filter(weapon => isWeaponEnabledForRandomizer(participant, selectedClass, weapon.name))
        currentLoadout.weapon = getWeightedRandomItem(
          weapons,
          (weapon) => getWeaponWeight(participant, selectedClass, weapon.name)
        )
      }

      // Randomly select 3 different gadgets (respecting locks)
      const currentGadgets = currentLoadout.gadgets || [null, null, null]
      const gadgetLocks = locks.gadgets || [false, false, false]
      
      // Get locked gadgets
      const lockedGadgets = currentGadgets.map((g, i) => gadgetLocks[i] ? g : null)
      
      // Get available gadgets (excluding already selected locked ones and excluded items)
      const lockedGadgetNames = lockedGadgets.filter(Boolean).map(g => g.name)
      const availableGadgets = (classData.gadgets || [])
        .filter(g => !lockedGadgetNames.includes(g.name))
        .filter(g => isGadgetEnabledForRandomizer(participant, selectedClass, g.name))
      
      // Fill unlocked slots with random gadgets
      const newGadgets = [...lockedGadgets]
      const remainingGadgets = [...availableGadgets]
      
      for (let i = 0; i < 3; i++) {
        if (!gadgetLocks[i] && remainingGadgets.length > 0) {
          const selectedGadget = getWeightedRandomItem(
            remainingGadgets,
            (gadget) => getGadgetWeight(participant, selectedClass, gadget.name)
          )
          if (selectedGadget) {
            newGadgets[i] = selectedGadget
            const selectedIdx = remainingGadgets.findIndex(g => g.name === selectedGadget.name)
            if (selectedIdx >= 0) {
              remainingGadgets.splice(selectedIdx, 1)
            }
          }
        }
      }
      
      currentLoadout.gadgets = newGadgets
    })

    return newLoadouts
  }

  const handleRandomizeLoadouts = () => {
    const next = buildRandomizedLoadouts(teamAssignments, lockedParticipants)
    if (next) setLoadouts(next)
  }

  // Randomize a single player's loadout
  const handleRandomizePlayerLoadout = (participant) => {
    if (!participant) return

    const classNames = Object.keys(gameConfig.classes) // ['light', 'medium', 'heavy']
    const newLoadouts = { ...loadouts }

    if (!newLoadouts[participant]) {
      newLoadouts[participant] = { class: null, specialization: null, weapon: null, gadgets: [null, null, null] }
    }
    
    const locks = lockedLoadouts[participant] || {}
    const currentLoadout = newLoadouts[participant]
    
    // Check if any loadout item (except class) is locked
    const hasLockedItems = locks.specialization || locks.weapon || (locks.gadgets && locks.gadgets.some(locked => locked))
    
    // Randomly select a class (if not locked and no other items are locked)
    if (!locks.class && !hasLockedItems) {
      const availableClasses = classNames
        .filter(className => isClassEnabledForRandomizer(participant, className))
      currentLoadout.class = getWeightedRandomItem(
        availableClasses,
        (className) => getClassWeight(participant, className)
      )
      // Clear specialization, weapon, and gadgets if class changed (unless locked)
      if (!locks.specialization) currentLoadout.specialization = null
      if (!locks.weapon) currentLoadout.weapon = null
      if (!locks.gadgets) {
        currentLoadout.gadgets = [null, null, null]
      } else {
        // Only clear unlocked gadgets
        currentLoadout.gadgets = currentLoadout.gadgets.map((g, i) => locks.gadgets[i] ? g : null)
      }
    }
    
    const selectedClass = currentLoadout.class
    const classData = selectedClass ? gameConfig.classes[selectedClass] : null
    if (!classData) {
      if (!locks.specialization) currentLoadout.specialization = null
      if (!locks.weapon) currentLoadout.weapon = null
      if (!locks.gadgets) currentLoadout.gadgets = [null, null, null]
      setLoadouts(newLoadouts)
      return
    }

    // Randomly select a specialization (if not locked)
    if (!locks.specialization) {
      const specializations = (classData.specializations || [])
        .filter(spec => isSpecializationEnabledForRandomizer(participant, selectedClass, spec.name))
      currentLoadout.specialization = getWeightedRandomItem(
        specializations,
        (spec) => getSpecializationWeight(participant, selectedClass, spec.name)
      )
    }

    // Randomly select a weapon (if not locked)
    if (!locks.weapon) {
      const weapons = (classData.weapons || [])
        .filter(weapon => isWeaponEnabledForRandomizer(participant, selectedClass, weapon.name))
      currentLoadout.weapon = getWeightedRandomItem(
        weapons,
        (weapon) => getWeaponWeight(participant, selectedClass, weapon.name)
      )
    }

    // Randomly select 3 different gadgets (respecting locks)
    const currentGadgets = currentLoadout.gadgets || [null, null, null]
    const gadgetLocks = locks.gadgets || [false, false, false]
    
    // Get locked gadgets
    const lockedGadgets = currentGadgets.map((g, i) => gadgetLocks[i] ? g : null)
    
      // Get available gadgets (excluding already selected locked ones and excluded items)
      const lockedGadgetNames = lockedGadgets.filter(Boolean).map(g => g.name)
      const availableGadgets = (classData.gadgets || [])
        .filter(g => !lockedGadgetNames.includes(g.name))
        .filter(g => isGadgetEnabledForRandomizer(participant, selectedClass, g.name))
    
    // Fill unlocked slots with random gadgets
    const newGadgets = [...lockedGadgets]
    const remainingGadgets = [...availableGadgets]
    
    for (let i = 0; i < 3; i++) {
      if (!gadgetLocks[i] && remainingGadgets.length > 0) {
        const selectedGadget = getWeightedRandomItem(
          remainingGadgets,
          (gadget) => getGadgetWeight(participant, selectedClass, gadget.name)
        )
        if (selectedGadget) {
          newGadgets[i] = selectedGadget
          const selectedIdx = remainingGadgets.findIndex(g => g.name === selectedGadget.name)
          if (selectedIdx >= 0) {
            remainingGadgets.splice(selectedIdx, 1)
          }
        }
      }
    }
    
    currentLoadout.gadgets = newGadgets
    setLoadouts(newLoadouts)
  }

  const getGlobalSettingsMap = (mapName) => {
    switch (mapName) {
      case 'classInputs': return classInputs
      case 'classEnabled': return classEnabled
      case 'specializationInputs': return specializationInputs
      case 'specializationEnabled': return specializationEnabled
      case 'weaponInputs': return weaponInputs
      case 'weaponEnabled': return weaponEnabled
      case 'gadgetInputs': return gadgetInputs
      case 'gadgetEnabled': return gadgetEnabled
      default: return {}
    }
  }

  const getPlayerOverrideMap = (participant, mapName) => {
    if (!participant || participant === SETTINGS_ALL_PLAYERS) return null
    return playerOverrides[participant]?.[mapName] || null
  }

  const getInputValueForParticipant = (participant, mapName, key) => {
    const hasOverride = !!playerOverrides[participant]
    if (hasOverride) {
      const overrideMap = getPlayerOverrideMap(participant, mapName)
      return overrideMap?.[key]
    }
    const globalMap = getGlobalSettingsMap(mapName)
    return globalMap[key]
  }

  const getEnabledValueForParticipant = (participant, mapName, key) => {
    const value = getInputValueForParticipant(participant, mapName, key)
    return value ?? true
  }

  const settingsTargetIsReadOnly =
    settingsTargetPlayer !== SETTINGS_ALL_PLAYERS && !playerOverrides[settingsTargetPlayer]

  const hasSelectedOverride =
    settingsTargetPlayer !== SETTINGS_ALL_PLAYERS && !!playerOverrides[settingsTargetPlayer]

  const getDisplayInputValue = (mapName, key) => {
    if (settingsTargetPlayer === SETTINGS_ALL_PLAYERS) {
      return getGlobalSettingsMap(mapName)[key]
    }
    return getInputValueForParticipant(settingsTargetPlayer, mapName, key)
  }

  const getDisplayEnabledValue = (mapName, key) => {
    if (settingsTargetPlayer === SETTINGS_ALL_PLAYERS) {
      return getGlobalSettingsMap(mapName)[key] ?? true
    }
    return getEnabledValueForParticipant(settingsTargetPlayer, mapName, key)
  }

  const updateSettingsMapValue = (mapName, key, value) => {
    if (settingsTargetPlayer === SETTINGS_ALL_PLAYERS) {
      switch (mapName) {
        case 'classInputs':
          setClassInputs(prev => ({ ...prev, [key]: value }))
          return
        case 'classEnabled':
          setClassEnabled(prev => ({ ...prev, [key]: value }))
          return
        case 'specializationInputs':
          setSpecializationInputs(prev => ({ ...prev, [key]: value }))
          return
        case 'specializationEnabled':
          setSpecializationEnabled(prev => ({ ...prev, [key]: value }))
          return
        case 'weaponInputs':
          setWeaponInputs(prev => ({ ...prev, [key]: value }))
          return
        case 'weaponEnabled':
          setWeaponEnabled(prev => ({ ...prev, [key]: value }))
          return
        case 'gadgetInputs':
          setGadgetInputs(prev => ({ ...prev, [key]: value }))
          return
        case 'gadgetEnabled':
          setGadgetEnabled(prev => ({ ...prev, [key]: value }))
          return
        default:
          return
      }
    }

    if (settingsTargetIsReadOnly) return

    setPlayerOverrides(prev => ({
      ...prev,
      [settingsTargetPlayer]: {
        ...prev[settingsTargetPlayer],
        [mapName]: {
          ...(prev[settingsTargetPlayer]?.[mapName] || {}),
          [key]: value
        }
      }
    }))
  }

  const createOverrideForPlayer = (participant) => {
    if (!participant || participant === SETTINGS_ALL_PLAYERS) return

    setPlayerOverrides(prev => ({
      ...prev,
      [participant]: {
        classInputs: { ...classInputs },
        classEnabled: { ...classEnabled },
        specializationInputs: { ...specializationInputs },
        specializationEnabled: { ...specializationEnabled },
        weaponInputs: { ...weaponInputs },
        weaponEnabled: { ...weaponEnabled },
        gadgetInputs: { ...gadgetInputs },
        gadgetEnabled: { ...gadgetEnabled }
      }
    }))
    setSettingsTargetPlayer(participant)
  }

  const removeOverrideForPlayer = (participant) => {
    if (!participant || participant === SETTINGS_ALL_PLAYERS) return
    setPlayerOverrides(prev => {
      const updated = { ...prev }
      delete updated[participant]
      return updated
    })
    if (settingsTargetPlayer === participant) {
      setSettingsTargetPlayer(SETTINGS_ALL_PLAYERS)
    }
  }

  const handleSettingsTargetChange = (nextTarget) => {
    if (!nextTarget) return
    if (nextTarget === SETTINGS_ALL_PLAYERS) {
      setSettingsTargetPlayer(SETTINGS_ALL_PLAYERS)
      return
    }
    if (playerOverrides[nextTarget]) {
      setSettingsTargetPlayer(nextTarget)
      return
    }
    createOverrideForPlayer(nextTarget)
  }

  const handleDeleteSelectedOverride = () => {
    if (!hasSelectedOverride) return
    removeOverrideForPlayer(settingsTargetPlayer)
  }

  const createUniformWeightMaps = () => {
    const nextClassInputs = {}
    const nextSpecializationInputs = {}
    const nextWeaponInputs = {}
    const nextGadgetInputs = {}

    for (const [className, classData] of Object.entries(gameConfig.classes)) {
      nextClassInputs[className] = '1'

      for (const specialization of classData.specializations || []) {
        nextSpecializationInputs[`${className}-${specialization.name}`] = '1'
      }

      for (const weapon of classData.weapons || []) {
        nextWeaponInputs[`${className}-${weapon.name}`] = '1'
      }

      for (const gadget of classData.gadgets || []) {
        nextGadgetInputs[`${className}-${gadget.name}`] = '1'
      }
    }

    return {
      classInputs: nextClassInputs,
      specializationInputs: nextSpecializationInputs,
      weaponInputs: nextWeaponInputs,
      gadgetInputs: nextGadgetInputs
    }
  }

  const handleSetAllWeightsToOne = () => {
    const nextWeightMaps = createUniformWeightMaps()

    if (settingsTargetPlayer === SETTINGS_ALL_PLAYERS) {
      setClassInputs(nextWeightMaps.classInputs)
      setSpecializationInputs(nextWeightMaps.specializationInputs)
      setWeaponInputs(nextWeightMaps.weaponInputs)
      setGadgetInputs(nextWeightMaps.gadgetInputs)
      return
    }

    if (settingsTargetIsReadOnly) return

    setPlayerOverrides((prev) => ({
      ...prev,
      [settingsTargetPlayer]: {
        ...prev[settingsTargetPlayer],
        classInputs: nextWeightMaps.classInputs,
        specializationInputs: nextWeightMaps.specializationInputs,
        weaponInputs: nextWeightMaps.weaponInputs,
        gadgetInputs: nextWeightMaps.gadgetInputs
      }
    }))
  }

  const createRandomWeightMaps = () => {
    const nextClassInputs = {}
    const nextSpecializationInputs = {}
    const nextWeaponInputs = {}
    const nextGadgetInputs = {}

    const randomWeightValue = () => String(Math.floor(Math.random() * 99) + 1)

    for (const [className, classData] of Object.entries(gameConfig.classes)) {
      nextClassInputs[className] = randomWeightValue()

      for (const specialization of classData.specializations || []) {
        nextSpecializationInputs[`${className}-${specialization.name}`] = randomWeightValue()
      }

      for (const weapon of classData.weapons || []) {
        nextWeaponInputs[`${className}-${weapon.name}`] = randomWeightValue()
      }

      for (const gadget of classData.gadgets || []) {
        nextGadgetInputs[`${className}-${gadget.name}`] = randomWeightValue()
      }
    }

    return {
      classInputs: nextClassInputs,
      specializationInputs: nextSpecializationInputs,
      weaponInputs: nextWeaponInputs,
      gadgetInputs: nextGadgetInputs
    }
  }

  const handleRandomizeSettingsWeights = () => {
    const nextWeightMaps = createRandomWeightMaps()

    if (settingsTargetPlayer === SETTINGS_ALL_PLAYERS) {
      setClassInputs(nextWeightMaps.classInputs)
      setSpecializationInputs(nextWeightMaps.specializationInputs)
      setWeaponInputs(nextWeightMaps.weaponInputs)
      setGadgetInputs(nextWeightMaps.gadgetInputs)
      return
    }

    if (settingsTargetIsReadOnly) return

    setPlayerOverrides((prev) => ({
      ...prev,
      [settingsTargetPlayer]: {
        ...prev[settingsTargetPlayer],
        classInputs: nextWeightMaps.classInputs,
        specializationInputs: nextWeightMaps.specializationInputs,
        weaponInputs: nextWeightMaps.weaponInputs,
        gadgetInputs: nextWeightMaps.gadgetInputs
      }
    }))
  }

  const getWeightedRandomItem = (items, getWeight) => {
    if (!items || items.length === 0) return null
    const weightedItems = items
      .map(item => ({ item, weight: getWeight(item) }))
      .filter(entry => entry.weight > 0)

    if (weightedItems.length === 0) return null

    const totalWeight = weightedItems.reduce((sum, entry) => sum + entry.weight, 0)
    let random = Math.random() * totalWeight

    for (const entry of weightedItems) {
      random -= entry.weight
      if (random <= 0) return entry.item
    }

    return weightedItems[weightedItems.length - 1].item
  }

  const getNumericWeight = (rawValue) => {
    const parsedWeight = Number(rawValue)
    return Number.isFinite(parsedWeight) ? Math.max(parsedWeight, 0) : 1
  }

  const isEnabledInRandomizer = (value) => value ?? true

  const getClassWeight = (participant, className) =>
    getNumericWeight(getInputValueForParticipant(participant, 'classInputs', className))
  const isClassEnabledForRandomizer = (participant, className) =>
    isEnabledInRandomizer(getEnabledValueForParticipant(participant, 'classEnabled', className))

  const getSpecializationWeight = (participant, className, specializationName) =>
    getNumericWeight(getInputValueForParticipant(participant, 'specializationInputs', `${className}-${specializationName}`))
  const isSpecializationEnabledForRandomizer = (participant, className, specializationName) =>
    isEnabledInRandomizer(getEnabledValueForParticipant(participant, 'specializationEnabled', `${className}-${specializationName}`))

  const getWeaponWeight = (participant, className, weaponName) =>
    getNumericWeight(getInputValueForParticipant(participant, 'weaponInputs', `${className}-${weaponName}`))
  const isWeaponEnabledForRandomizer = (participant, className, weaponName) =>
    isEnabledInRandomizer(getEnabledValueForParticipant(participant, 'weaponEnabled', `${className}-${weaponName}`))

  const getGadgetWeight = (participant, className, gadgetName) =>
    getNumericWeight(getInputValueForParticipant(participant, 'gadgetInputs', `${className}-${gadgetName}`))
  const isGadgetForcedDisabledForMode = (className, gadgetName) =>
    selectedGamemode === 'team_deathmatch' &&
    className === 'medium' &&
    gadgetName === 'Defibrillator'
  const isGadgetEnabledForRandomizer = (participant, className, gadgetName) =>
    !isGadgetForcedDisabledForMode(className, gadgetName) &&
    isEnabledInRandomizer(getEnabledValueForParticipant(participant, 'gadgetEnabled', `${className}-${gadgetName}`))

  const formatPercent = (value) => {
    if (!Number.isFinite(value)) return '0%'
    const rounded = Math.round(value * 10) / 10
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`
  }

  const getSettingsWeightPercent = (inputMapName, enabledMapName, key, categoryKeys) => {
    const isEnabled = getDisplayEnabledValue(enabledMapName, key)
    if (!isEnabled) return 0

    const itemWeight = getNumericWeight(getDisplayInputValue(inputMapName, key))
    const enabledTotal = categoryKeys.reduce((sum, categoryKey) => {
      if (!getDisplayEnabledValue(enabledMapName, categoryKey)) return sum
      return sum + getNumericWeight(getDisplayInputValue(inputMapName, categoryKey))
    }, 0)

    if (enabledTotal <= 0) return 0
    return (itemWeight / enabledTotal) * 100
  }

  // Get available maps for selected gamemode
  const getAvailableMaps = () => {
    if (!selectedGamemode) return []
    const modeConfig = gameConfig.gamemodes[selectedGamemode]
    return modeConfig?.maps || []
  }

  // Get map details from map ID
  const getMapDetails = (mapId) => {
    if (!mapId) return null
    return mapsConfig.map_modifiers[mapId] || null
  }

  // Handle gamemode change - reset map and weather if not locked
  const handleGamemodeChange = (newGamemode) => {
    setSelectedGamemode(newGamemode)
    if (!lockedMap) {
      setSelectedMapId(null)
    }
    if (!lockedWeather) {
      setSelectedWeather(null)
    }
  }

  // Handle map change - reset weather if not locked
  const handleMapChange = (newMapId) => {
    if (!selectedGamemode) return // Don't allow map selection without gamemode
    setSelectedMapId(newMapId)
    if (!lockedWeather) {
      setSelectedWeather(null)
    }
  }

  // Randomize gamemode
  const handleRandomizeGamemode = () => {
    if (lockedGamemode) return
    const availableModes = Object.keys(gameConfig.gamemodes)
    const randomMode = availableModes[Math.floor(Math.random() * availableModes.length)]
    handleGamemodeChange(randomMode)
  }

  // Randomize map
  const handleRandomizeMap = () => {
    if (lockedMap || !selectedGamemode) return
    const availableMaps = getAvailableMaps()
    if (availableMaps.length === 0) return
    const randomMapId = availableMaps[Math.floor(Math.random() * availableMaps.length)]
    handleMapChange(randomMapId)
  }

  // Randomize weather
  const handleRandomizeWeather = () => {
    if (lockedWeather || !selectedMapId) return
    const mapDetails = getMapDetails(selectedMapId)
    if (!mapDetails || !mapDetails.weather || mapDetails.weather.length === 0) return
    const randomWeather = mapDetails.weather[Math.floor(Math.random() * mapDetails.weather.length)]
    setSelectedWeather(randomWeather)
  }

  const handleRandomizeLoadoutRandomTarget = () => {
    if (lockedLoadoutRandomTarget) return
    if (loadoutRandomTargets.length === 0) return
    const randomTarget = loadoutRandomTargets[Math.floor(Math.random() * loadoutRandomTargets.length)]
    setSelectedLoadoutRandomTarget(randomTarget)
  }

  const handleRandomizeSingleLoadoutItem = (participant, type, index = null) => {
    if (!participant || lockedParticipants[participant] !== undefined) return

    const classNames = Object.keys(gameConfig.classes)
    const newLoadouts = { ...loadouts }
    if (!newLoadouts[participant]) {
      newLoadouts[participant] = { class: null, specialization: null, weapon: null, gadgets: [null, null, null] }
    }

    const locks = lockedLoadouts[participant] || {}
    const currentLoadout = newLoadouts[participant]

    if (type === 'class') {
      if (locks.class) return
      const hasLockedDependent =
        locks.specialization ||
        locks.weapon ||
        (locks.gadgets && locks.gadgets.some((locked) => locked))
      if (hasLockedDependent) return

      const availableClasses = classNames
        .filter((className) => isClassEnabledForRandomizer(participant, className))
      const randomClass = getWeightedRandomItem(
        availableClasses,
        (className) => getClassWeight(participant, className)
      )
      if (!randomClass) return
      const classChanged = currentLoadout.class !== randomClass
      currentLoadout.class = randomClass
      if (classChanged) {
        if (!locks.specialization) currentLoadout.specialization = null
        if (!locks.weapon) currentLoadout.weapon = null
        if (!locks.gadgets) {
          currentLoadout.gadgets = [null, null, null]
        } else {
          currentLoadout.gadgets = (currentLoadout.gadgets || [null, null, null]).map((g, i) =>
            locks.gadgets[i] ? g : null
          )
        }
      }
      setLoadouts(newLoadouts)
      return
    }

    const selectedClass = currentLoadout.class
    const classData = selectedClass ? gameConfig.classes[selectedClass] : null
    if (!classData) return

    if (type === 'specialization') {
      if (locks.specialization) return
      const specializations = (classData.specializations || [])
        .filter((spec) => isSpecializationEnabledForRandomizer(participant, selectedClass, spec.name))
      const randomSpec = getWeightedRandomItem(
        specializations,
        (spec) => getSpecializationWeight(participant, selectedClass, spec.name)
      )
      if (!randomSpec) return
      currentLoadout.specialization = randomSpec
      setLoadouts(newLoadouts)
      return
    }

    if (type === 'weapon') {
      if (locks.weapon) return
      const weapons = (classData.weapons || [])
        .filter((weapon) => isWeaponEnabledForRandomizer(participant, selectedClass, weapon.name))
      const randomWeapon = getWeightedRandomItem(
        weapons,
        (weapon) => getWeaponWeight(participant, selectedClass, weapon.name)
      )
      if (!randomWeapon) return
      currentLoadout.weapon = randomWeapon
      setLoadouts(newLoadouts)
      return
    }

    if (type === 'gadget' && index !== null) {
      const gadgetLocks = locks.gadgets || [false, false, false]
      if (gadgetLocks[index]) return
      const currentGadgets = currentLoadout.gadgets || [null, null, null]
      const blockedNames = currentGadgets
        .map((g, i) => (i === index ? null : g?.name))
        .filter(Boolean)
      const availableGadgets = (classData.gadgets || [])
        .filter((gadget) => !blockedNames.includes(gadget.name))
        .filter((gadget) => isGadgetEnabledForRandomizer(participant, selectedClass, gadget.name))
      const randomGadget = getWeightedRandomItem(
        availableGadgets,
        (gadget) => getGadgetWeight(participant, selectedClass, gadget.name)
      )
      if (!randomGadget) return
      if (!currentLoadout.gadgets) currentLoadout.gadgets = [null, null, null]
      currentLoadout.gadgets[index] = randomGadget
      setLoadouts(newLoadouts)
    }
  }

  // Update randomize all to include map/weather
  const handleRandomizeAll = () => {
    let nextGamemode = selectedGamemode
    if (!lockedGamemode) {
      const modes = Object.keys(gameConfig.gamemodes)
      nextGamemode = modes[Math.floor(Math.random() * modes.length)]
      setSelectedGamemode(nextGamemode)
    }

    if (!nextGamemode) {
      if (!lockedLoadoutRandomTarget) {
        handleRandomizeLoadoutRandomTarget()
      }
      const teamResultEarly = buildRandomizedTeamResult(selectedGamemode)
      if (teamResultEarly) {
        setTeamAssignments(teamResultEarly.compactedAssignments)
        setLockedParticipants(teamResultEarly.updatedLocks)
        const loadoutNextEarly = buildRandomizedLoadouts(
          teamResultEarly.compactedAssignments,
          teamResultEarly.updatedLocks
        )
        if (loadoutNextEarly) setLoadouts(loadoutNextEarly)
      } else {
        handleRandomizeLoadouts()
      }
      return
    }

    let nextMapId = selectedMapId
    if (!lockedMap) {
      const maps = gameConfig.gamemodes[nextGamemode]?.maps || []
      nextMapId = maps.length ? maps[Math.floor(Math.random() * maps.length)] : null
    }

    let nextWeather = selectedWeather
    const mapDetailsForRand = nextMapId ? getMapDetails(nextMapId) : null
    const weatherList = mapDetailsForRand?.weather
    if (!lockedWeather) {
      nextWeather =
        weatherList?.length ? weatherList[Math.floor(Math.random() * weatherList.length)] : null
    } else if (weatherList?.length) {
      nextWeather =
        selectedWeather && weatherList.includes(selectedWeather)
          ? selectedWeather
          : weatherList[Math.floor(Math.random() * weatherList.length)]
    } else {
      nextWeather = null
    }

    setSelectedMapId(nextMapId)
    setSelectedWeather(nextWeather)
    if (!lockedLoadoutRandomTarget) {
      handleRandomizeLoadoutRandomTarget()
    }

    const teamResult = buildRandomizedTeamResult(nextGamemode)
    if (teamResult) {
      setTeamAssignments(teamResult.compactedAssignments)
      setLockedParticipants(teamResult.updatedLocks)
      const loadoutNext = buildRandomizedLoadouts(
        teamResult.compactedAssignments,
        teamResult.updatedLocks
      )
      if (loadoutNext) setLoadouts(loadoutNext)
    } else {
      handleRandomizeLoadouts()
    }
  }

  // Get selected map's modifier and display name
  const getMapDisplayName = () => {
    if (!selectedMapId) return '-- Select a map --'
    const mapDetails = getMapDetails(selectedMapId)
    if (!mapDetails) return selectedMapId.replace('__', ' / ').replace(/_/g, ' ')
    return `${mapDetails.map.replace(/_/g, ' ')} / ${mapDetails.modifier}`
  }

  const getSelectedModeConfig = () => {
    if (!selectedGamemode) return null
    return gameConfig.gamemodes[selectedGamemode]
  }

  const getLoadoutLabelClass = (text) => {
    const length = (text || '').length
    if (length > 15) return 'long-label'
    if (length >= 10) return 'medium-label'
    return ''
  }

  const getGamemodeDisplayName = (mode) => {
    if (!mode) return '--'
    return mode.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
  }

  const modeConfig = getSelectedModeConfig()
  const availableMaps = getAvailableMaps()
  const sortedAvailableMaps = useMemo(
    () =>
      [...availableMaps].sort((a, b) => {
        const aDetails = getMapDetails(a)
        const bDetails = getMapDetails(b)
        const aLabel = aDetails
          ? `${aDetails.map.replace(/_/g, ' ')} / ${aDetails.modifier}`
          : a.replace('__', ' / ').replace(/_/g, ' ')
        const bLabel = bDetails
          ? `${bDetails.map.replace(/_/g, ' ')} / ${bDetails.modifier}`
          : b.replace('__', ' / ').replace(/_/g, ' ')
        return aLabel.localeCompare(bLabel, undefined, {
          sensitivity: 'base',
          numeric: true
        })
      }),
    [availableMaps]
  )
  const selectedMapDetails = getMapDetails(selectedMapId)
  const sortedWeatherOptions = useMemo(
    () =>
      [...(selectedMapDetails?.weather || [])].sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
      ),
    [selectedMapDetails?.weather]
  )
  const unassignedParticipantsCount = useMemo(() => {
    const assignedParticipants = new Set(Object.values(teamAssignments).flat().filter(Boolean))
    return participants.reduce(
      (count, name) =>
        assignedParticipants.has(name) || isParticipantUnavailableForTeams(name) ? count : count + 1,
      0
    )
  }, [participants, teamAssignments, isParticipantUnavailableForTeams])
  const effectiveUnassignedParticipantsCount = isViewOnlyMode ? 0 : unassignedParticipantsCount
  const normalizedGamemode = (selectedGamemode || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  const isTdmFamilyMode =
    normalizedGamemode === 'team_deathmatch' ||
    normalizedGamemode === 'power_shift'
  const isDynamicLayoutMode = isDynamicLayoutModeConfig(modeConfig)
  const isTeamDeathmatchMode = isTdmFamilyMode && !isDynamicLayoutMode
  const participantsListPoolReplacePreview =
    !isViewOnlyMode &&
    modeConfig != null &&
    teamDnD != null &&
    !isParticipantUnavailableForTeams(teamDnD.participant) &&
    teamDnD.fromTeam == null &&
    teamDnDHover != null &&
    teamDnDHover.teamIndex != null &&
    teamDnDHover.slotIndex != null &&
    previewTeamDragDrop({
      assignments: teamAssignments,
      lockedParticipants,
      participant: teamDnD.participant,
      fromTeam: teamDnD.fromTeam,
      fromSlot: teamDnD.fromSlot,
      targetTeamIndex: teamDnDHover.teamIndex,
      targetSlotIndex: teamDnDHover.slotIndex,
      targetOccupant:
        teamAssignments[teamDnDHover.teamIndex]?.[teamDnDHover.slotIndex] || null,
      maxPerTeam: modeConfig.players_per_team
    }) === 'replace'
  useEffect(() => {
    if (!isDynamicLayoutMode) {
      setDynamicLayoutRuntimeMetrics({
        teamHeaderReserve: null,
        playerNameRowHeight: null,
        assignOptionsReserve: null
      })
      return
    }

    const panelEl = teamsPanelRef.current
    if (!panelEl) return

    const getOuterHeight = (el) => {
      if (!el) return null
      const style = window.getComputedStyle(el)
      const marginTop = Number.parseFloat(style.marginTop || '0') || 0
      const marginBottom = Number.parseFloat(style.marginBottom || '0') || 0
      return el.getBoundingClientRect().height + marginTop + marginBottom
    }

    const measure = () => {
      const root = panelEl.querySelector('.teams-container.is-dynamic-layout')
      if (!root) return
      const teamHeaderEl = root.querySelector('.team-block h3')
      const playerNameRowEl = root.querySelector('.player-name-row')
      const assignOptionsEl = root.querySelector('.assign-options')

      setDynamicLayoutRuntimeMetrics({
        teamHeaderReserve: getOuterHeight(teamHeaderEl),
        playerNameRowHeight: getOuterHeight(playerNameRowEl),
        assignOptionsReserve: getOuterHeight(assignOptionsEl) || 0
      })
    }

    const rafId = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(rafId)
  }, [isDynamicLayoutMode, teamsPanelWidth, teamsPanelHeight, viewportWidth, effectiveUnassignedParticipantsCount, participants.length, teamAssignments, isViewOnlyMode, layoutRefreshNonce])

  const computedDynamicLayout = useMemo(
    () => {
      // Force recompute after Vite HMR updates in dev.
      void layoutRefreshNonce
      return isDynamicLayoutMode
        ? computeDynamicLayout({
            panelWidth: teamsPanelWidth,
            viewportWidth,
            panelHeight: teamsPanelHeight,
            teams: modeConfig?.teams,
            playersPerTeam: modeConfig?.players_per_team,
            hasAssignOptions: effectiveUnassignedParticipantsCount > 0,
            assignOptionsCount: effectiveUnassignedParticipantsCount,
            teamHeaderReserve: dynamicLayoutRuntimeMetrics.teamHeaderReserve,
            playerNameRowHeight: dynamicLayoutRuntimeMetrics.playerNameRowHeight,
            assignOptionsReserve: dynamicLayoutRuntimeMetrics.assignOptionsReserve
          })
        : null
    },
    [
      isDynamicLayoutMode,
      teamsPanelWidth,
      viewportWidth,
      teamsPanelHeight,
      modeConfig?.teams,
      modeConfig?.players_per_team,
      effectiveUnassignedParticipantsCount,
      dynamicLayoutRuntimeMetrics.teamHeaderReserve,
      dynamicLayoutRuntimeMetrics.playerNameRowHeight,
      dynamicLayoutRuntimeMetrics.assignOptionsReserve,
      layoutRefreshNonce
    ]
  )
  useEffect(() => {
    if (!isDynamicLayoutMode) {
      setLastStableDynamicLayout(null)
      return
    }
    if (computedDynamicLayout) {
      setLastStableDynamicLayout(computedDynamicLayout)
    }
  }, [isDynamicLayoutMode, computedDynamicLayout])
  const resolvedDynamicLayout =
    isDynamicLayoutMode ? computedDynamicLayout || lastStableDynamicLayout : null
  const dynamicLayoutClasses = resolvedDynamicLayout
    ? [
        'is-dynamic-layout',
        `layout-team-${resolvedDynamicLayout.teamGrid.rows}x${resolvedDynamicLayout.teamGrid.cols}`,
        `layout-player-${resolvedDynamicLayout.playerGrid.rows}x${resolvedDynamicLayout.playerGrid.cols}`,
        `layout-loadout-${resolvedDynamicLayout.loadoutGrid.rows}x${resolvedDynamicLayout.loadoutGrid.cols}`
      ]
    : []
  const dynamicLayoutLabelBaseFontSize = resolvedDynamicLayout
    ? Math.max(14, Math.min(22, Math.round(resolvedDynamicLayout.itemSize * 0.16)))
    : null
  const dynamicLayoutLabelMediumFontSize =
    dynamicLayoutLabelBaseFontSize !== null ? Math.max(13, dynamicLayoutLabelBaseFontSize - 1) : null
  const dynamicLayoutLabelLongFontSize =
    dynamicLayoutLabelBaseFontSize !== null ? Math.max(12, dynamicLayoutLabelBaseFontSize - 2) : null
  const dynamicLayoutStyle = resolvedDynamicLayout
    ? {
        '--layout-team-rows': `${resolvedDynamicLayout.teamGrid.rows}`,
        '--layout-team-cols': `${resolvedDynamicLayout.teamGrid.cols}`,
        '--layout-player-rows': `${resolvedDynamicLayout.playerGrid.rows}`,
        '--layout-player-cols': `${resolvedDynamicLayout.playerGrid.cols}`,
        '--layout-loadout-rows': `${resolvedDynamicLayout.loadoutGrid.rows}`,
        '--layout-loadout-cols': `${resolvedDynamicLayout.loadoutGrid.cols}`,
        '--layout-item-size': `${resolvedDynamicLayout.itemSize}px`,
        '--layout-label-height': `${resolvedDynamicLayout.labelHeight}px`,
        '--layout-slot-width': `${Math.floor(resolvedDynamicLayout.slotRequiredWidth)}px`,
        '--layout-slot-height': `${Math.floor(resolvedDynamicLayout.slotRequiredHeight)}px`,
        '--layout-player-grid-width': `${Math.floor(resolvedDynamicLayout.playerGridWidth)}px`,
        '--layout-player-grid-height': `${Math.floor(resolvedDynamicLayout.playerGridHeight)}px`,
        '--layout-team-block-width': `${Math.floor(resolvedDynamicLayout.teamBlockWidth)}px`,
        '--layout-team-block-height': `${Math.floor(resolvedDynamicLayout.teamBlockHeight)}px`,
        '--layout-label-font-size': `${dynamicLayoutLabelBaseFontSize}px`,
        '--layout-label-font-size-medium': `${dynamicLayoutLabelMediumFontSize}px`,
        '--layout-label-font-size-long': `${dynamicLayoutLabelLongFontSize}px`
      }
    : undefined
  const tdmLikeSlotCountClass = normalizedGamemode === 'head2head' ? 'is-three-per-team' : 'is-five-per-team'
  const teamsPanelWidthClass =
    teamsPanelWidth <= 2500 ? 'is-under-2500' : teamsPanelWidth <= 2800 ? 'is-under-2800' : 'is-over-2800'
  const gamemodeClassName = normalizedGamemode ? `mode-${normalizedGamemode.replace(/_/g, '-')}` : ''
  const teamsContainerClassName = [
    'teams-container',
    isDynamicLayoutMode ? '' : gamemodeClassName,
    isTeamDeathmatchMode ? 'teams-container-tdm' : '',
    isTeamDeathmatchMode ? (isTeamsPanelPortrait ? 'is-portrait' : 'is-landscape') : '',
    isTeamDeathmatchMode ? teamsPanelWidthClass : '',
    isTeamDeathmatchMode ? tdmLikeSlotCountClass : '',
    ...dynamicLayoutClasses
  ]
    .filter(Boolean)
    .join(' ')
  const classesList = useMemo(
    () =>
      Object.keys(gameConfig.classes).map((className) => ({
        key: className,
        className,
        name: className.charAt(0).toUpperCase() + className.slice(1),
        imageFile: gameConfig.class_images?.[className] || ''
      })),
    []
  )
  const specializationsByClass = useMemo(
    () =>
      Object.entries(gameConfig.classes).map(([className, classData]) => ({
        className,
        specializations: classData.specializations.map((specialization) => ({
          key: `${className}-${specialization.name}`,
          className,
          name: specialization.name,
          imageFile: specialization.imageFile
        }))
      })),
    []
  )
  const weaponsByClass = useMemo(
    () =>
      Object.entries(gameConfig.classes).map(([className, classData]) => ({
        className,
        weapons: classData.weapons.map((weapon) => ({
          key: `${className}-${weapon.name}`,
          className,
          name: weapon.name,
          imageFile: weapon.imageFile
        }))
      })),
    []
  )
  const gadgetsByClass = useMemo(
    () =>
      Object.entries(gameConfig.classes).map(([className, classData]) => ({
        className,
        gadgets: classData.gadgets.map((gadget) => ({
          key: `${className}-${gadget.name}`,
          className,
          name: gadget.name,
          imageFile: gadget.imageFile
        }))
      })),
    []
  )

  const isValidDeepLinkGroup = useMemo(() => {
    const g = new URLSearchParams(locationSearch).get('group') || ''
    return Boolean(g && GROUP_UUID_PARAM_RE.test(g))
  }, [locationSearch])

  const renderSelectorOptionCard = ({
    key,
    label,
    imageFile,
    itemType,
    onSelect,
    disabled = false,
    title
  }) => (
    <div className={`weapon-settings-card selector-option-card ${disabled ? 'disabled' : ''}`} key={key}>
      <div className="loadout-item-wrapper settings-weapon-wrapper">
        <div
          className={`loadout-item ${itemType}-item settings-weapon-preview selector-option-preview ${disabled ? 'disabled' : ''}`}
          onClick={disabled ? undefined : onSelect}
          title={title}
          aria-disabled={disabled}
        >
          {imageFile ? (
            <img src={imageFile} alt={label} className={`${itemType}-image`} />
          ) : (
            <span className="loadout-item-text">{label}</span>
          )}
        </div>
        <div className={`loadout-item-label ${getLoadoutLabelClass(label)}`}>
          <em>{label}</em>
        </div>
      </div>
    </div>
  )

  if (!groupsInitialised && isValidDeepLinkGroup) {
    return <FullPageLoading label="Loading group" />
  }

  if (!activeGroupId) {
    const groupsLoading = !groupsInitialised
    return (
      <div className={`groups-dashboard-page ${isDashboardSidebarOverlayMode ? 'sidebar-overlay-mode' : ''}`}>
        {isDashboardSidebarOverlayMode && !isDashboardSidebarCollapsed ? (
          <button
            className="groups-dashboard-sidebar-backdrop"
            onClick={() => setIsDashboardSidebarCollapsed(true)}
            aria-label="Close dashboard sidebar"
            title="Close dashboard sidebar"
          />
        ) : null}
        <aside className={`groups-dashboard-sidebar ${isDashboardSidebarCollapsed ? 'is-collapsed' : ''} ${isDashboardSidebarOverlayMode && !isDashboardSidebarCollapsed ? 'is-overlay' : ''}`}>
          <div className="groups-dashboard-sidebar-header">
            <div className="groups-dashboard-sidebar-logo" aria-label="The Finals Customs">
              <span className="groups-dashboard-sidebar-logo-line1">The Finals</span>
              <span className="groups-dashboard-sidebar-logo-line2">Customs</span>
            </div>
            {isDashboardSidebarOverlayMode ? (
              <button
                className="groups-dashboard-sidebar-collapse-btn"
                onClick={() => setIsDashboardSidebarCollapsed(true)}
                title="Collapse dashboard sidebar"
                aria-label="Collapse dashboard sidebar"
              >
                <ChevronLeftIcon />
              </button>
            ) : null}
          </div>
          <div className="groups-dashboard-join">
            <label className="groups-dashboard-label" htmlFor="join-code-input">
              Join with code
            </label>
            <input
              id="join-code-input"
              type="text"
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
              placeholder="Enter join code"
              className="access-auth-input groups-dashboard-join-input"
              autoCapitalize="characters"
              disabled={groupsLoading}
            />
            <button
              type="button"
              className="randomize-btn groups-dashboard-join-btn"
              onClick={handleJoinGroup}
              disabled={groupsLoading || joinBusy || !joinCodeInput.trim()}
            >
              {joinBusy ? 'Joining…' : 'Join group'}
            </button>
          </div>
          <div className="groups-dashboard-settings-placeholder">
            <p className="groups-dashboard-settings-title">Settings</p>
            <p className="groups-dashboard-settings-hint">
              Account settings are in the profile menu. Group settings will live here.
            </p>
          </div>
          <div className="groups-dashboard-sidebar-footer">
            <div className="profile-menu-wrap profile-menu-wrap-sidebar">
              <button
                ref={profileMenuButtonRef}
                type="button"
                className="groups-dashboard-profile-button"
                onClick={() => setIsProfileMenuOpen((prev) => !prev)}
                title="Open profile menu"
                aria-label="Open profile menu"
                aria-haspopup="menu"
                aria-expanded={isProfileMenuOpen}
              >
                <img className="profile-avatar-img" src={profileAvatarUrl} alt={`${profileDisplayName} profile`} />
              </button>
              {isProfileMenuOpen && (
                <div
                  ref={profileMenuRef}
                  className="profile-menu-dropdown profile-menu-dropdown-sidebar"
                  role="menu"
                >
                  <button
                    type="button"
                    className="profile-menu-item"
                    onClick={handleRefreshProfilePicture}
                    role="menuitem"
                    disabled={refreshProfilePictureBusy}
                  >
                    {refreshProfilePictureBusy ? 'Refreshing picture…' : 'Refresh profile picture'}
                  </button>
                  <button
                    type="button"
                    className="profile-menu-item"
                    onClick={handleOpenUserSettings}
                    role="menuitem"
                  >
                    User settings
                  </button>
                  <button
                    type="button"
                    className="profile-menu-item profile-menu-item-danger"
                    onClick={handleSignOut}
                    role="menuitem"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
            <div className="groups-dashboard-profile-meta">
              <span className="groups-dashboard-profile-name">{profileDisplayName}</span>
              {session?.user?.email && <span className="groups-dashboard-profile-email">{session.user.email}</span>}
            </div>
          </div>
        </aside>
        <main className="groups-dashboard-main" aria-busy={groupsLoading}>
          {isDashboardSidebarOverlayMode && isDashboardSidebarCollapsed ? (
            <button
              className="groups-dashboard-sidebar-open-btn"
              onClick={() => setIsDashboardSidebarCollapsed(false)}
              title="Open dashboard sidebar"
              aria-label="Open dashboard sidebar"
            >
              <ChevronRightIcon />
              <span>Open Sidebar</span>
            </button>
          ) : null}
          <h1 className="groups-dashboard-main-title">Dashboard</h1>
          {groupsLoading ? (
            <p className="visually-hidden" role="status" aria-live="polite">
              Loading groups
            </p>
          ) : null}
          {groupsLoadError && <p className="access-modal-error">{groupsLoadError}</p>}
          <p className="groups-dashboard-main-help">
            Open a group below, create a new one, or join with a code from the sidebar.
          </p>
          {createGroupModalOpen && (
            <div
              className="modal-overlay"
              role="presentation"
              onClick={() => {
                if (!createGroupBusy) {
                  setCreateGroupModalOpen(false)
                  setNewGroupName('')
                }
              }}
            >
              <div
                className="modal-content groups-dashboard-create-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="create-group-modal-title"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-body">
                  <h2 id="create-group-modal-title" className="groups-dashboard-create-modal-title">
                    Create group
                  </h2>
                  <label htmlFor="create-group-name-input" className="groups-dashboard-create-modal-label">
                    Group name
                  </label>
                  <input
                    id="create-group-name-input"
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="Enter group name"
                    className="access-auth-input groups-dashboard-create-name-input"
                    disabled={createGroupBusy}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateGroup()
                    }}
                  />
                  <div className="groups-dashboard-create-modal-actions">
                    <button
                      type="button"
                      className="groups-dashboard-create-cancel-btn"
                      onClick={() => {
                        setCreateGroupModalOpen(false)
                        setNewGroupName('')
                      }}
                      disabled={createGroupBusy}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="randomize-btn groups-dashboard-create-submit-btn"
                      onClick={handleCreateGroup}
                      disabled={createGroupBusy || !newGroupName.trim()}
                    >
                      {createGroupBusy ? 'Creating…' : 'Create'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="groups-dashboard-tile-grid">
            {groupsLoading ? (
              <>
                <GroupsDashboardCreateTileSkeleton />
                {Array.from({ length: DASHBOARD_GROUP_TILE_SKELETON_COUNT }, (_, i) => (
                  <GroupsDashboardTileSkeleton key={i} />
                ))}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="groups-dashboard-create-tile"
                  onClick={() => setCreateGroupModalOpen(true)}
                  aria-label="Create group"
                >
                  <span className="groups-dashboard-create-tile-plus" aria-hidden={true}>
                    <FontAwesomeIcon icon={faPlus} className={FA_ICON_CLASS} />
                  </span>
                </button>
                {myGroups.filter((g) => g.name !== 'Default').map((g) => {
                  const memberCount = g.member_count ?? 0
                  const overflow =
                    memberCount > DASHBOARD_MEMBER_CHIP_PREVIEW
                      ? memberCount - DASHBOARD_MEMBER_CHIP_PREVIEW
                      : 0
                  return (
                    <button
                      key={g.id}
                      type="button"
                      className="groups-dashboard-group-tile"
                      onClick={() => openGroup(g)}
                    >
                      <div
                        className="groups-dashboard-group-tile-banner"
                        style={groupDashboardBannerStyle(g.id)}
                        aria-hidden={true}
                      />
                      <div className="groups-dashboard-group-tile-body">
                        {(g.member_preview_user_ids?.length > 0 || overflow > 0) && (
                          <div className="groups-dashboard-member-chips" aria-hidden={true}>
                            {(g.member_preview_user_ids || []).map((uid, idx) => (
                              <span
                                key={uid}
                                className="groups-dashboard-member-chip"
                                style={{
                                  background: memberChipColor(uid),
                                  zIndex: DASHBOARD_MEMBER_CHIP_PREVIEW - idx
                                }}
                              />
                            ))}
                            {overflow > 0 && (
                              <span className="groups-dashboard-member-overflow">+{overflow}</span>
                            )}
                          </div>
                        )}
                        <span className="groups-dashboard-group-tile-name">{g.name}</span>
                        <span className="groups-dashboard-group-tile-meta">
                          {g.join_code} · {g.role}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </>
            )}
          </div>
        </main>
      </div>
    )
  }

  if (!groupRole) {
    return <FullPageLoading label="Loading group" />
  }

  return (
    <div className={`App ${isViewOnlyMode ? 'is-view-only' : ''}`}>
      <header className="App-header">
        <div className="top-left-controls">
          <button
            type="button"
            className="dashboard-nav-link"
            onClick={backToGroupsDashboard}
            title="Back to dashboard"
            aria-label="Back to dashboard"
          >
            <ChevronLeftIcon />
            <span className="dashboard-nav-label dashboard-nav-label--desktop">Dashboard</span>
          </button>
          <button
            type="button"
            className="dashboard-nav-arrow-btn"
            onClick={backToGroupsDashboard}
            title="Back to dashboard"
            aria-label="Back to dashboard"
          >
            <FontAwesomeIcon icon={faArrowLeft} className={`${FA_ICON_CLASS} dashboard-nav-arrow-icon`} aria-hidden />
          </button>
        </div>
        <h1 className="app-title">The Finals Customs</h1>
        {/* Top Right Controls */}
        <div className="top-right-controls">
          {!isViewOnlyMode && (
            <button 
              className="randomize-all-btn" 
              onClick={handleRandomizeAll}
            >
              <DiceIcon />
              <span className="randomize-all-label">Randomize All</span>
            </button>
          )}
          <div className="profile-menu-wrap">
            <button
              ref={profileMenuButtonRef}
              type="button"
              className="profile-menu-trigger"
              onClick={() => setIsProfileMenuOpen((prev) => !prev)}
              title="Open profile menu"
              aria-label="Open profile menu"
              aria-haspopup="menu"
              aria-expanded={isProfileMenuOpen}
            >
              <img className="profile-avatar-img" src={profileAvatarUrl} alt={`${profileDisplayName} profile`} />
            </button>
            {isProfileMenuOpen && (
              <div ref={profileMenuRef} className="profile-menu-dropdown" role="menu">
                <div className="profile-menu-user">
                  <span className="profile-menu-name">{profileDisplayName}</span>
                  {session?.user?.email && <span className="profile-menu-email">{session.user.email}</span>}
                </div>
                <button
                  type="button"
                  className="profile-menu-item"
                  onClick={backToGroupsDashboard}
                  role="menuitem"
                >
                  Dashboard
                </button>
                <button
                  type="button"
                  className="profile-menu-item"
                  onClick={handleRefreshProfilePicture}
                  role="menuitem"
                  disabled={refreshProfilePictureBusy}
                >
                  {refreshProfilePictureBusy ? 'Refreshing picture…' : 'Refresh profile picture'}
                </button>
                <button
                  type="button"
                  className="profile-menu-item"
                  onClick={handleOpenUserSettings}
                  role="menuitem"
                >
                  User settings
                </button>
                <button
                  type="button"
                  className="profile-menu-item profile-menu-item-danger"
                  onClick={handleSignOut}
                  role="menuitem"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="App-main">
        <div className={`app-workspace ${isSidebarOverlayMode ? 'sidebar-overlay-mode' : ''}`}>
          {sidebarOverlayChromeVisible ? (
            <div className="sidebar-collapsed-spacer" aria-hidden="true" />
          ) : null}
          {sidebarOverlayChromeVisible ? (
            <button
              className="sidebar-overlay-backdrop"
              onClick={() => setIsSidebarCollapsed(true)}
              aria-label="Close sidebar overlay"
              title="Close sidebar overlay"
            />
          ) : null}
          <aside
            className={`app-sidebar ${sidebarShowsCollapsedChrome ? 'is-collapsed' : ''} ${
              sidebarOverlayChromeVisible ? 'is-overlay' : ''
            }`}
          >
            {!isViewOnlyMode &&
              (isSidebarCollapsed ? (
                <button
                  className="sidebar-collapse-btn sidebar-collapse-btn-full"
                  onClick={() => setIsSidebarCollapsed(false)}
                  title="Expand sidebar"
                  aria-label="Expand sidebar"
                >
                  <ChevronRightIcon />
                  <span>Open Panel</span>
                </button>
              ) : (
                <div className="sidebar-panel-header">
                  <h2 className="sidebar-panel-title">Control Panel</h2>
                  <button
                    className="sidebar-collapse-btn"
                    onClick={() => setIsSidebarCollapsed(true)}
                    title="Collapse sidebar"
                    aria-label="Collapse sidebar"
                  >
                    <ChevronLeftIcon />
                  </button>
                </div>
              ))}
            {sidebarShowsCollapsedChrome ? (
              <div className="sidebar-collapsed-summary">
                <div className="collapsed-summary-item">
                  <div className="collapsed-summary-meta">
                    <span className="collapsed-summary-icon"><ModeIcon /></span>
                    <span className="collapsed-summary-title">Mode</span>
                  </div>
                  <div className="collapsed-summary-data">
                    <span className="collapsed-summary-value">{getGamemodeDisplayName(selectedGamemode)}</span>
                  </div>
                </div>
                <div className="collapsed-summary-item">
                  <div className="collapsed-summary-meta">
                    <span className="collapsed-summary-icon"><MapIcon /></span>
                    <span className="collapsed-summary-title">Map</span>
                  </div>
                  <div className="collapsed-summary-data">
                    <span className="collapsed-summary-value">{selectedMapId ? getMapDisplayName() : '--'}</span>
                  </div>
                </div>
                <div className="collapsed-summary-item">
                  <div className="collapsed-summary-meta">
                    <span className="collapsed-summary-icon"><WeatherIcon /></span>
                    <span className="collapsed-summary-title">Weather</span>
                  </div>
                  <div className="collapsed-summary-data">
                    {selectedMapDetails && selectedWeather ? (
                      <span className="collapsed-summary-value">{`${selectedMapDetails.modifier} / ${selectedWeather}`}</span>
                    ) : (
                      <span className="collapsed-summary-value">--</span>
                    )}
                  </div>
                </div>
                <div className="collapsed-summary-item">
                  <div className="collapsed-summary-meta">
                    <span className="collapsed-summary-icon"><RefreshIcon /></span>
                    <span className="collapsed-summary-title">Change Up</span>
                  </div>
                  <div className="collapsed-summary-data">
                    <span className="collapsed-summary-value">{selectedLoadoutRandomTarget || '--'}</span>
                  </div>
                </div>
              </div>
            ) : (
              <>
            {useMobilePanelTabs ? (
              <div className="mobile-panel-toggle" role="tablist" aria-label="Loadouts panel sections">
                <button
                  type="button"
                  className={`mobile-panel-toggle__btn ${
                    mobilePanelTab === 'game-options' ? 'is-active' : ''
                  }`}
                  onClick={() => setMobilePanelTab('game-options')}
                  role="tab"
                  aria-selected={mobilePanelTab === 'game-options'}
                >
                  Game Options
                </button>
                <button
                  type="button"
                  className={`mobile-panel-toggle__btn ${
                    mobilePanelTab === 'participants' ? 'is-active' : ''
                  }`}
                  onClick={() => setMobilePanelTab('participants')}
                  role="tab"
                  aria-selected={mobilePanelTab === 'participants'}
                >
                  Participants
                </button>
              </div>
            ) : null}
            {showGameOptionsPanel ? (
              <div className="mobile-panel-section mobile-panel-section--game-options">
            {/* Game Mode, Map, and Weather Selectors */}
            {isViewOnlyMode ? (
            <div className="selectors-row selectors-row--read-only">
              <div className="selector-group">
                <span className="selector-group__label">Game Mode:</span>
                <div className="selector-readonly-row">
                  <span className="selector-readonly-value">{getGamemodeDisplayName(selectedGamemode)}</span>
                  <span
                    className={`selector-readonly-lock ${lockedGamemode ? 'is-locked' : ''}`}
                    title={lockedGamemode ? 'Locked' : 'Unlocked'}
                    aria-label={lockedGamemode ? 'Locked' : 'Unlocked'}
                  >
                    {lockedGamemode ? <LockIcon /> : <UnlockIcon />}
                  </span>
                </div>
              </div>
              <div className="selector-group">
                <span className="selector-group__label">Map:</span>
                <div className="selector-readonly-row">
                  <span className="selector-readonly-value">
                    {selectedMapId ? getMapDisplayName() : '--'}
                  </span>
                  <span
                    className={`selector-readonly-lock ${lockedMap ? 'is-locked' : ''}`}
                    title={lockedMap ? 'Locked' : 'Unlocked'}
                    aria-label={lockedMap ? 'Locked' : 'Unlocked'}
                  >
                    {lockedMap ? <LockIcon /> : <UnlockIcon />}
                  </span>
                </div>
              </div>
              <div className="selector-group">
                <span className="selector-group__label">Weather/Modifier:</span>
                <div className="selector-readonly-row">
                  <span className="selector-readonly-value">
                    {selectedMapDetails && selectedWeather
                      ? `${selectedMapDetails.modifier} / ${selectedWeather}`
                      : '--'}
                  </span>
                  <span
                    className={`selector-readonly-lock ${lockedWeather ? 'is-locked' : ''}`}
                    title={lockedWeather ? 'Locked' : 'Unlocked'}
                    aria-label={lockedWeather ? 'Locked' : 'Unlocked'}
                  >
                    {lockedWeather ? <LockIcon /> : <UnlockIcon />}
                  </span>
                </div>
              </div>
              <div className="selector-group">
                <span className="selector-group__label">Change Up:</span>
                <div className="selector-readonly-row">
                  <span className="selector-readonly-value">{selectedLoadoutRandomTarget || '--'}</span>
                  <span
                    className={`selector-readonly-lock ${lockedLoadoutRandomTarget ? 'is-locked' : ''}`}
                    title={lockedLoadoutRandomTarget ? 'Locked' : 'Unlocked'}
                    aria-label={lockedLoadoutRandomTarget ? 'Locked' : 'Unlocked'}
                  >
                    {lockedLoadoutRandomTarget ? <LockIcon /> : <UnlockIcon />}
                  </span>
                </div>
              </div>
            </div>
            ) : (
            <div className="selectors-row">
              {/* Game Mode Selector */}
              <div className="selector-group">
                <label htmlFor="gamemode-select">Game Mode:</label>
                <div className="selector-with-actions">
                  <select
                    id="gamemode-select"
                    value={selectedGamemode || ''}
                    onChange={(e) => handleGamemodeChange(e.target.value || null)}
                    disabled={lockedGamemode}
                  >
                    <option value="">-- Select a gamemode --</option>
                    {gamemodes.map(mode => (
                      <option key={mode} value={mode}>
                        {mode.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        {gameConfig.gamemodes[mode] && 
                          ` (${gameConfig.gamemodes[mode].teams} teams of ${gameConfig.gamemodes[mode].players_per_team})`
                        }
                      </option>
                    ))}
                  </select>
                  <button
                    className="selector-action-btn"
                    onClick={handleRandomizeGamemode}
                    disabled={lockedGamemode}
                    title="Randomize gamemode"
                  >
                    <DiceIcon />
                  </button>
                  <button
                    className={`selector-action-btn ${lockedGamemode ? 'locked' : ''}`}
                    onClick={() => {
                      const newLockState = !lockedGamemode
                      setLockedGamemode(newLockState)
                      if (!newLockState) {
                        setLockedMap(false)
                        setLockedWeather(false)
                      }
                    }}
                    title={lockedGamemode ? 'Unlock gamemode (and map/weather)' : 'Lock gamemode'}
                  >
                    {lockedGamemode ? <LockIcon /> : <UnlockIcon />}
                  </button>
                </div>
              </div>

              {/* Map Selector */}
              <div className="selector-group">
                <label htmlFor="map-select">Map:</label>
                <div className="selector-with-actions">
                  <select
                    id="map-select"
                    value={selectedMapId || ''}
                    onChange={(e) => handleMapChange(e.target.value || null)}
                    disabled={lockedMap || !selectedGamemode}
                  >
                    <option value="">-- Select a map --</option>
                    {sortedAvailableMaps.map(mapId => {
                      const mapDetails = getMapDetails(mapId)
                      const displayName = mapDetails 
                        ? `${mapDetails.map.replace(/_/g, ' ')} - ${mapDetails.modifier}`
                        : mapId.replace('__', ' - ').replace(/_/g, ' ')
                      return (
                        <option key={mapId} value={mapId}>
                          {displayName}
                        </option>
                      )
                    })}
                  </select>
                  <button
                    className="selector-action-btn"
                    onClick={handleRandomizeMap}
                    disabled={lockedMap || !selectedGamemode}
                    title="Randomize map"
                  >
                    <DiceIcon />
                  </button>
                  <button
                    className={`selector-action-btn ${lockedMap ? 'locked' : ''}`}
                    onClick={() => {
                      const newLockState = !lockedMap
                      setLockedMap(newLockState)
                      if (!newLockState) {
                        setLockedWeather(false)
                      }
                    }}
                    disabled={!selectedGamemode}
                    title={lockedMap ? 'Unlock map (and weather)' : 'Lock map'}
                  >
                    {lockedMap ? <LockIcon /> : <UnlockIcon />}
                  </button>
                </div>
              </div>

              {/* Weather/Modifier Selector */}
              <div className="selector-group">
                <label htmlFor="weather-select">Weather/Modifier:</label>
                <div className="selector-with-actions">
                  <select
                    id="weather-select"
                    value={selectedWeather || ''}
                    onChange={(e) => setSelectedWeather(e.target.value || null)}
                    disabled={lockedWeather || !selectedMapId}
                  >
                    <option value="">-- Select weather --</option>
                    {sortedWeatherOptions.map(weather => (
                      <option key={weather} value={weather}>
                        {selectedMapDetails.modifier} / {weather}
                      </option>
                    ))}
                  </select>
                  <button
                    className="selector-action-btn"
                    onClick={handleRandomizeWeather}
                    disabled={lockedWeather || !selectedMapId}
                    title="Randomize weather"
                  >
                    <DiceIcon />
                  </button>
                  <button
                    className={`selector-action-btn ${lockedWeather ? 'locked' : ''}`}
                    onClick={() => {
                      const next = !lockedWeather
                      setLockedWeather(next)
                      if (next) setLockedMap(true)
                    }}
                    disabled={!selectedMapId}
                    title={lockedWeather ? 'Unlock weather' : 'Lock weather'}
                  >
                    {lockedWeather ? <LockIcon /> : <UnlockIcon />}
                  </button>
                </div>
              </div>

              {/* Change Up Selector */}
              <div className="selector-group">
                <label htmlFor="loadout-random-target-select">Change Up:</label>
                <div className="selector-with-actions">
                  <select
                    id="loadout-random-target-select"
                    value={selectedLoadoutRandomTarget}
                    onChange={(e) => setSelectedLoadoutRandomTarget(e.target.value)}
                    disabled={lockedLoadoutRandomTarget}
                  >
                    <option value="">-- Select target --</option>
                    {loadoutRandomTargets.map((target) => (
                      <option key={target} value={target}>
                        {target}
                      </option>
                    ))}
                  </select>
                  <button
                    className="selector-action-btn"
                    onClick={handleRandomizeLoadoutRandomTarget}
                    disabled={lockedLoadoutRandomTarget}
                    title="Randomize loadout target"
                  >
                    <DiceIcon />
                  </button>
                  <button
                    className={`selector-action-btn ${lockedLoadoutRandomTarget ? 'locked' : ''}`}
                    onClick={() => setLockedLoadoutRandomTarget(!lockedLoadoutRandomTarget)}
                    title={lockedLoadoutRandomTarget ? 'Unlock Change Up' : 'Lock Change Up'}
                  >
                    {lockedLoadoutRandomTarget ? <LockIcon /> : <UnlockIcon />}
                  </button>
                </div>
              </div>
            </div>
            )}

            {/* Randomize Buttons */}
            {!isViewOnlyMode && selectedGamemode && participants.length > 0 && (
              <div className="randomize-section">
                <button 
                  className="randomize-btn" 
                  onClick={handleRandomizeTeams}
                >
                  Randomize Teams
                </button>
                <button 
                  className="randomize-btn" 
                  onClick={handleRandomizeLoadouts}
                >
                  Randomize Loadouts
                </button>
                <button 
                  className="randomize-btn clear-btn" 
                  onClick={() => {
                    setLoadouts({})
                    setLockedLoadouts({})
                  }}
                >
                  Clear Loadouts
                </button>
              </div>
            )}
              </div>
            ) : null}

            {/* Participants Panel */}
            {showParticipantsPanel ? (
            <div className="participants-panel mobile-panel-section mobile-panel-section--participants">
              <div className="participants-header">
                <h2>Participants</h2>
                {!isViewOnlyMode ? (
                  <div className="participants-header-actions">
                    <button
                      className="settings-icon-btn"
                      onClick={() => setIsTeamSettingsModalOpen(true)}
                      title="Team Settings"
                      aria-label="Open team settings"
                    >
                      <SettingsIcon />
                    </button>
                    <button
                      className="settings-icon-btn"
                      onClick={() => setIsSettingsModalOpen(true)}
                      title="Randomizer Overrides"
                      aria-label="Open randomizer overrides"
                    >
                      <OverridesIcon />
                    </button>
                  </div>
                ) : null}
              </div>
              <div
                ref={participantsListRef}
                className={[
                  'participants-list',
                  (participantsDropHover || participantsListPoolReplacePreview) &&
                    'participants-list--drop-target',
                  participantsListPoolReplacePreview && 'participants-list--drop-target--replace',
                  participantsListHasOverflow && 'participants-list--has-scrollbar'
                ]
                  .filter(Boolean)
                  .join(' ')}
                onDragOver={handleParticipantsListDragOver}
                onDragLeave={handleParticipantsListDragLeave}
                onDrop={handleParticipantsListDrop}
                onScroll={() => {
                  if (participantActionsMenuUserId != null) {
                    setParticipantActionsMenuUserId(null)
                    setParticipantActionsTeamsSubOpen(false)
                    setParticipantActionsMenuPosition(null)
                    setParticipantActionsTeamsSubStyle({})
                  }
                }}
              >
                {groupMembersError ? (
                  <p className="empty-state">{groupMembersError}</p>
                ) : !groupMembersReady &&
                  participants.length === 0 &&
                  groupMemberRoster.length === 0 ? (
                  <ParticipantsListSkeleton />
                ) : participants.length === 0 ? (
                  <p className="empty-state">
                    No one is in this group yet. Share the join code from the group list so teammates can join.
                  </p>
                ) : (
                  participants.map((id) => {
                    const row = groupMemberRosterById.get(id)
                    const label = labelForParticipant(id)
                    const isAssigned = assignedParticipantIdSet.has(id)
                    const teamBlocked = isParticipantUnavailableForTeams(id)
                    const draggable = !isViewOnlyMode && !isAssigned && !teamBlocked
                    const roleRaw = row?.role || 'member'
                    const roleLabel = roleRaw ? roleRaw.charAt(0).toUpperCase() + roleRaw.slice(1) : ''
                    const isOnline = onlineUserIdSet.has(id)
                    const manualStatus = normalizeGroupManualStatus(row?.manual_status)
                    const availabilityStatus =
                      manualStatus === 'unavailable' ? 'unavailable' : 'available'
                    const canEditStatus =
                      !!session?.user?.id &&
                      canEditGroupManualStatus({
                        actorRole: groupRole,
                        actorUserId: session.user.id,
                        targetUserId: id,
                        targetMembershipRole: roleRaw
                      })
                    const teamMenuEntries = modeConfig
                      ? Array.from({ length: modeConfig.teams }, (_, ti) => {
                          const list = teamAssignments[ti] || []
                          const isCurrentTeam = list.includes(id)
                          const isTeamFull = list.length >= modeConfig.players_per_team
                          const isDisabled = teamBlocked || isCurrentTeam || isTeamFull
                          return {
                            teamIndex: ti,
                            isDisabled
                          }
                        })
                      : []
                    const showParticipantMakeAdmin = groupRole === 'owner' && roleRaw === 'member'
                    const showParticipantMakeMember = groupRole === 'owner' && roleRaw === 'admin'
                    const showParticipantToggleAvail = canEditStatus
                    const showParticipantRemove = canRemoveGroupMemberFromGroup(groupRole, roleRaw)
                    const showParticipantAddToTeam = !isViewOnlyMode && teamMenuEntries.length > 0
                    const isSelfParticipantRow = session?.user?.id === id
                    const showParticipantLeaveGroup = groupRole !== 'owner' && isSelfParticipantRow
                    const showParticipantMakeNewOwner =
                      groupRole === 'owner' && !isSelfParticipantRow && roleRaw !== 'owner'
                    const showInlineAvailabilityChip = canEditStatus && !isViewOnlyMode
                    const hasParticipantRowMenu = isViewOnlyMode
                      ? Boolean(
                          isSelfParticipantRow && (showParticipantToggleAvail || showParticipantLeaveGroup)
                        )
                      : showParticipantMakeAdmin ||
                        showParticipantMakeNewOwner ||
                        showParticipantMakeMember ||
                        showParticipantToggleAvail ||
                        showParticipantRemove ||
                        showParticipantAddToTeam ||
                        showParticipantLeaveGroup
                    return (
                      <div
                        key={id}
                        className={[
                          'participant-item',
                          isAssigned && 'participant-item--assigned',
                          availabilityStatus === 'unavailable' && 'participant-item--unavailable',
                          participantActionsMenuUserId === id && 'participant-item--menu-open'
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        draggable={draggable}
                        onDragStart={draggable ? (e) => handleParticipantPoolDragStart(e, id) : undefined}
                        onDragEnd={draggable ? endTeamDnD : undefined}
                      >
                        <div
                          className="participant-item__main"
                          onMouseDown={isAssigned ? () => pulseAssignedParticipantInLoadout(id) : undefined}
                        >
                          <div
                            className={[
                              'participant-item__avatar-wrap',
                              isOnline && 'participant-item__avatar-wrap--online'
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            <img
                              className="participant-item__avatar"
                              src={participantAvatarSrc(row || {}, label)}
                              alt=""
                              draggable={false}
                            />
                          </div>
                          <div className="participant-item__text">
                            <span className="participant-item__name-row">
                              <span className="participant-item__name">{label}</span>
                              {isAssigned ? (
                                <span
                                  className="participant-item__assigned-check"
                                  aria-label={`${label} is assigned`}
                                  title="Assigned"
                                >
                                  ✓
                                </span>
                              ) : null}
                            </span>
                            <div className="participant-item__badges">
                              <span
                                className={[
                                  'participant-badge',
                                  'participant-badge--role',
                                  `participant-badge--role-${roleRaw}`
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                {roleRaw === 'owner' ? (
                                  <FontAwesomeIcon
                                    icon={faCrown}
                                    className={`${FA_ICON_CLASS} participant-role-icon`}
                                    aria-hidden
                                  />
                                ) : null}
                                {roleRaw === 'admin' ? (
                                  <FontAwesomeIcon
                                    icon={faUserShield}
                                    className={`${FA_ICON_CLASS} participant-role-icon`}
                                    aria-hidden
                                  />
                                ) : null}
                                <span>{roleLabel}</span>
                              </span>
                              {showInlineAvailabilityChip && session?.user ? (
                                <button
                                  type="button"
                                  className={[
                                    'participant-badge',
                                    'participant-badge--manual-status',
                                    'participant-manual-status-chip-toggle',
                                    availabilityStatus === 'available' && 'is-available',
                                    availabilityStatus === 'unavailable' && 'is-unavailable'
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                  onClick={() =>
                                    handleGroupManualStatusChange(
                                      id,
                                      availabilityStatus === 'unavailable' ? 'available' : 'unavailable'
                                    )
                                  }
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  aria-label={`Toggle availability for ${label}`}
                                  title={`Set ${label} to ${
                                    availabilityStatus === 'unavailable' ? 'Available' : 'Unavailable'
                                  }`}
                                >
                                  <span>{groupManualStatusLabel(availabilityStatus)}</span>
                                  <span
                                    className="participant-manual-status-chip-toggle__icon"
                                    aria-hidden="true"
                                  >
                                    <RefreshIcon />
                                  </span>
                                </button>
                              ) : (
                                <span
                                  className={[
                                    'participant-badge',
                                    'participant-badge--manual-status',
                                    availabilityStatus === 'available' && 'is-available',
                                    availabilityStatus === 'unavailable' && 'is-unavailable'
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                >
                                  {groupManualStatusLabel(availabilityStatus)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {hasParticipantRowMenu ? (
                          <div
                            className="participant-item__actions-wrap"
                            data-participant-actions-wrap={id}
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="participant-item__menu-trigger"
                              aria-haspopup="menu"
                              aria-expanded={participantActionsMenuUserId === id}
                              aria-controls={
                                participantActionsMenuUserId === id
                                  ? `participant-row-menu-${id}`
                                  : undefined
                              }
                              aria-label={`Actions for ${label}`}
                              onClick={(e) => {
                                const triggerRect = e.currentTarget.getBoundingClientRect()
                                participantMenuTriggerRectRef.current = triggerRect
                                setParticipantActionsMenuUserId((open) => (open === id ? null : id))
                                setParticipantActionsTeamsSubOpen(false)
                                if (participantActionsMenuUserId === id) {
                                  setParticipantActionsMenuPosition(null)
                                } else {
                                  setParticipantActionsMenuPosition({
                                    top: triggerRect.bottom + MENU_TRIGGER_GAP,
                                    left: triggerRect.right
                                  })
                                }
                              }}
                            >
                              <ParticipantMenuDotsIcon />
                            </button>
                            {participantActionsMenuUserId === id ? (
                              <div
                                ref={participantActionsMenuRef}
                                className="participant-actions-menu"
                                id={`participant-row-menu-${id}`}
                                role="menu"
                                style={
                                  participantActionsMenuPosition
                                    ? {
                                        position: 'fixed',
                                        top: `${participantActionsMenuPosition.top}px`,
                                        left: `${participantActionsMenuPosition.left}px`,
                                        right: 'auto',
                                        marginTop: 0,
                                        transform: 'translateX(-100%)',
                                        ...(participantActionsMenuPosition.maxHeight != null
                                          ? {
                                              maxHeight: participantActionsMenuPosition.maxHeight,
                                              overflowY:
                                                participantActionsMenuPosition.overflowY || 'auto'
                                            }
                                          : {})
                                      }
                                    : undefined
                                }
                              >
                                {showParticipantMakeAdmin ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="participant-actions-menu__item"
                                    onClick={() => handleParticipantMenuSetRole(id, 'admin')}
                                  >
                                    Make admin
                                  </button>
                                ) : null}
                                {showParticipantMakeMember ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="participant-actions-menu__item"
                                    onClick={() => handleParticipantMenuSetRole(id, 'member')}
                                  >
                                    Make member
                                  </button>
                                ) : null}
                                {showParticipantMakeNewOwner ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="participant-actions-menu__item participant-actions-menu__item--danger"
                                    onClick={() => handleParticipantMenuMakeNewOwner(id)}
                                  >
                                    Make new owner
                                  </button>
                                ) : null}
                                {showParticipantToggleAvail ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="participant-actions-menu__item"
                                    onClick={() => {
                                      handleGroupManualStatusChange(
                                        id,
                                        availabilityStatus === 'unavailable' ? 'available' : 'unavailable'
                                      )
                                      setParticipantActionsMenuUserId(null)
                                      setParticipantActionsTeamsSubOpen(false)
                                      setParticipantActionsMenuPosition(null)
                                    }}
                                  >
                                    {availabilityStatus === 'unavailable'
                                      ? 'Set available'
                                      : 'Set unavailable'}
                                  </button>
                                ) : null}
                                {showParticipantAddToTeam ? (
                                  <div className="participant-actions-menu__sub-host">
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="participant-actions-menu__item participant-actions-menu__item--with-chevron"
                                      aria-haspopup="true"
                                      aria-expanded={
                                        participantActionsTeamsSubOpen &&
                                        participantActionsMenuUserId === id
                                      }
                                      onClick={() => setParticipantActionsTeamsSubOpen((s) => !s)}
                                    >
                                      <span>Add to team</span>
                                      <ChevronRightIcon />
                                    </button>
                                    {participantActionsTeamsSubOpen ? (
                                      <div
                                        className="participant-actions-menu__sub"
                                        role="presentation"
                                        style={participantActionsTeamsSubStyle}
                                      >
                                        {teamMenuEntries.map((entry) => (
                                          <button
                                            key={entry.teamIndex}
                                            type="button"
                                            role="menuitem"
                                            className={[
                                              'participant-actions-menu__item',
                                              'participant-actions-menu__sub-item',
                                              entry.isDisabled && 'is-disabled'
                                            ]
                                              .filter(Boolean)
                                              .join(' ')}
                                            disabled={entry.isDisabled}
                                            onClick={() => {
                                              if (entry.isDisabled) return
                                              handleAssignToTeam(id, entry.teamIndex)
                                              setParticipantActionsMenuUserId(null)
                                              setParticipantActionsTeamsSubOpen(false)
                                              setParticipantActionsMenuPosition(null)
                                            }}
                                          >
                                            {gameConfig.teams?.[entry.teamIndex]?.name ||
                                              `Team ${entry.teamIndex + 1}`}
                                          </button>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : null}
                                {showParticipantRemove ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="participant-actions-menu__item participant-actions-menu__item--danger"
                                    onClick={() => handleParticipantMenuRemove(id)}
                                  >
                                    Remove from group
                                  </button>
                                ) : null}
                                {showParticipantLeaveGroup ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="participant-actions-menu__item participant-actions-menu__item--danger"
                                    onClick={handleParticipantMenuLeaveGroup}
                                  >
                                    Leave group
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
            ) : null}
              </>
            )}
          </aside>

          <section className="app-content">
            {/* Main Content Area */}
            <div className="main-content">
          {/* Team Builds Panel */}
          <div
            className="teams-panel"
            ref={teamsPanelRef}
            onScroll={() => {
              if (assignedSlotMenuKey != null) closeAssignedSlotMenu()
            }}
          >
            {!selectedGamemode ? (
              <p className="empty-state">Select a gamemode to see team structure</p>
            ) : (
              <DynamicLayoutRoot
                className={teamsContainerClassName}
                style={dynamicLayoutStyle}
                data-gamemode={normalizedGamemode || 'none'}
                data-layout-mode={isTeamDeathmatchMode ? (isTeamsPanelPortrait ? 'portrait' : 'landscape') : 'default'}
              >
                {modeConfig &&
                  (() => {
                    const gHoverTeam = teamDnDHover?.teamIndex
                    const gHoverSlot = teamDnDHover?.slotIndex
                    const gHoverOccupant =
                      gHoverTeam != null && gHoverSlot != null && gHoverSlot >= 0
                        ? teamAssignments[gHoverTeam]?.[gHoverSlot] || null
                        : null
                    const gHoverPreview =
                      teamDnD &&
                      gHoverTeam != null &&
                      !isViewOnlyMode &&
                      !isParticipantUnavailableForTeams(teamDnD.participant)
                        ? gHoverSlot == null
                          ? (() => {
                              const assignForPlace = removeParticipantFromAssignments(
                                teamAssignments,
                                teamDnD.participant
                              )
                              const placeIdx = firstEmptySlotIndex(
                                assignForPlace[gHoverTeam] || [],
                                modeConfig.players_per_team
                              )
                              return placeIdx < 0
                                ? 'invalid'
                                : previewTeamDragDrop({
                                    assignments: teamAssignments,
                                    lockedParticipants,
                                    participant: teamDnD.participant,
                                    fromTeam: teamDnD.fromTeam,
                                    fromSlot: teamDnD.fromSlot,
                                    targetTeamIndex: gHoverTeam,
                                    targetSlotIndex: placeIdx,
                                    targetOccupant: null,
                                    maxPerTeam: modeConfig.players_per_team
                                  })
                            })()
                          : previewTeamDragDrop({
                              assignments: teamAssignments,
                              lockedParticipants,
                              participant: teamDnD.participant,
                              fromTeam: teamDnD.fromTeam,
                              fromSlot: teamDnD.fromSlot,
                              targetTeamIndex: gHoverTeam,
                              targetSlotIndex: gHoverSlot,
                              targetOccupant: gHoverOccupant,
                              maxPerTeam: modeConfig.players_per_team
                            })
                        : null
                    const gAssignmentsForSnappedPlace =
                      teamDnD && gHoverPreview === 'place'
                        ? removeParticipantFromAssignments(teamAssignments, teamDnD.participant)
                        : teamAssignments
                    const gSnappedPlaceSlotIndex =
                      gHoverPreview === 'place' && gHoverTeam != null
                        ? firstEmptySlotIndex(
                            gAssignmentsForSnappedPlace[gHoverTeam] || [],
                            modeConfig.players_per_team
                          )
                        : -1
                    const slotDropPreviewCls = 'team-slot-drop-preview'
                    const assignedAcrossTeams = Object.values(teamAssignments).flat()
                    const unassignedParticipants = participants.filter(
                      (p) => !assignedAcrossTeams.includes(p) && !isParticipantUnavailableForTeams(p)
                    )

                    return Array.from({ length: modeConfig.teams }, (_, teamIndex) => (
                  <div
                    key={teamIndex}
                    className="team-block"
                    onDragOver={(e) => handleTeamBlockDragOver(e, teamIndex)}
                    onDragLeave={(e) => handleTeamBlockDragLeave(e, teamIndex)}
                    onDrop={(e) => handleTeamBlockDrop(e, teamIndex)}
                  >
                    <h3>
                      {gameConfig.teams && gameConfig.teams[teamIndex] ? (
                        (() => {
                          const team = gameConfig.teams[teamIndex]
                          return (
                            <>
                              {team.imageFile && (
                                <img 
                                  src={team.imageFile} 
                                  alt={team.name}
                                  className="team-logo"
                                />
                              )}
                              <span>{team.name.toUpperCase()}</span>
                            </>
                          )
                        })()
                      ) : (
                        `Team ${teamIndex + 1}`
                      )}
                    </h3>
                    <div className="team-slots">
                      {Array.from({ length: modeConfig.players_per_team }, (_, slotIndex) => {
                        const assignedPlayer = teamAssignments[teamIndex]?.[slotIndex]
                        const isHover =
                          teamDnDHover?.teamIndex === teamIndex && teamDnDHover?.slotIndex === slotIndex
                        const isDragSource =
                          teamDnD &&
                          teamDnD.fromTeam === teamIndex &&
                          teamDnD.fromSlot === slotIndex
                        const dropPreview =
                          teamDnD && isHover && !isViewOnlyMode ? gHoverPreview : null
                        const isSameTeamEmptyHover =
                          teamDnD &&
                          isHover &&
                          !assignedPlayer &&
                          teamDnD.fromTeam != null &&
                          teamDnD.fromTeam === teamIndex
                        const isSnappedPlaceSlot =
                          gHoverPreview === 'place' &&
                          gHoverTeam === teamIndex &&
                          gSnappedPlaceSlotIndex === slotIndex
                        const showPrimaryGhost =
                          teamDnD &&
                          !isViewOnlyMode &&
                          gHoverPreview &&
                          gHoverPreview !== 'invalid' &&
                          ((gHoverPreview === 'place' && isSnappedPlaceSlot) ||
                            ((gHoverPreview === 'swap' || gHoverPreview === 'replace') && isHover))
                        const showSwapCounterpartGhost =
                          teamDnD &&
                          !isViewOnlyMode &&
                          gHoverPreview === 'swap' &&
                          teamDnD.fromTeam != null &&
                          teamIndex === teamDnD.fromTeam &&
                          slotIndex === teamDnD.fromSlot &&
                          gHoverOccupant
                        const previewClass = (() => {
                          if (isViewOnlyMode || !teamDnD) return ''
                          if (isSameTeamEmptyHover) return ''
                          if (isSnappedPlaceSlot) {
                            return `${slotDropPreviewCls} ${slotDropPreviewCls}--place ${slotDropPreviewCls}--snap`
                          }
                          if (dropPreview === 'place') return ''
                          return dropPreview ? `${slotDropPreviewCls} ${slotDropPreviewCls}--${dropPreview}` : ''
                        })()
                        const baseTitle = assignedPlayer
                          ? `${labelForParticipant(assignedPlayer)}${lockedParticipants[assignedPlayer] === teamIndex ? ' (locked)' : ''}`
                          : isViewOnlyMode
                            ? 'View mode'
                            : unassignedParticipants.length > 0
                              ? 'Empty slot — drag a member from the pool'
                              : 'No available members'
                        const dragTitle =
                          !isViewOnlyMode && teamDnD && isHover && dropPreview
                            ? isSameTeamEmptyHover
                              ? ''
                              : dropPreview === 'place'
                              ? isSnappedPlaceSlot
                                ? ' — Adds to first open slot on this team.'
                                : ''
                              : dropPreview === 'swap'
                                ? ' — Swap both players.'
                                : dropPreview === 'replace'
                                  ? ' — Replace; freed player returns to the pool.'
                                  : ' — Cannot drop here.'
                            : ''
                        const positionLockedHere = lockedParticipants[assignedPlayer] === teamIndex
                        return (
                          <div
                            key={slotIndex}
                            className={`team-slot ${assignedPlayer ? 'filled' : 'empty'} ${lockedParticipants[assignedPlayer] === teamIndex ? 'locked' : ''} ${isDragSource ? 'team-slot--drag-source' : ''} ${assignedPlayer === linkedParticipantPulseId ? 'is-linked-participant-pulse' : ''} ${previewClass}`.trim()}
                            onDragOver={(e) =>
                              handleTeamSlotDragOver(e, teamIndex, slotIndex, assignedPlayer || null)
                            }
                            onDragLeave={(e) => handleTeamSlotDragLeave(e, teamIndex, slotIndex)}
                            onDrop={(e) =>
                              handleTeamSlotDrop(e, teamIndex, slotIndex, assignedPlayer || null)
                            }
                            title={`${baseTitle}${dragTitle}`}
                          >
                            {showPrimaryGhost ? (
                              <div
                                className="team-slot-dnd-ghost team-slot-dnd-ghost--primary"
                                aria-hidden
                              >
                                <span className="team-slot-dnd-ghost-name">
                                  {labelForParticipant(teamDnD.participant)}
                                </span>
                              </div>
                            ) : null}
                            {showSwapCounterpartGhost ? (
                              <div
                                className="team-slot-dnd-ghost team-slot-dnd-ghost--swap-counterpart"
                                aria-hidden
                              >
                                <span className="team-slot-dnd-ghost-name">
                                  {labelForParticipant(gHoverOccupant)}
                                </span>
                              </div>
                            ) : null}
                            {assignedPlayer ? (
                              <div
                                className={`player-slot-content ${
                                  lockedParticipants[assignedPlayer] !== teamIndex &&
                                  !isParticipantUnavailableForTeams(assignedPlayer)
                                    ? 'player-draggable-source'
                                    : ''
                                }`}
                                draggable={
                                  !isViewOnlyMode &&
                                  lockedParticipants[assignedPlayer] !== teamIndex &&
                                  !isParticipantUnavailableForTeams(assignedPlayer)
                                }
                                onDragStart={(e) =>
                                  handleTeamPlayerDragStart(e, assignedPlayer, teamIndex, slotIndex)
                                }
                                onDragEnd={endTeamDnD}
                              >
                                <div className="player-name-row">
                                  <span className="player-name">
                                    <span className="player-name-text">{labelForParticipant(assignedPlayer)}</span>
                                    {positionLockedHere ? (
                                      <span
                                        className="player-position-lock"
                                        title="Position locked"
                                        aria-label="Position locked"
                                      >
                                        <PositionLockIcon />
                                      </span>
                                    ) : null}
                                  </span>
                                  {(() => {
                                      const slotMenuKey = `${teamIndex}-${slotIndex}`
                                      const rosterRow = groupMemberRosterById.get(assignedPlayer)
                                      const membershipRole = rosterRow?.role || 'member'
                                      const canEditAssignedManualStatus =
                                        !!session?.user?.id &&
                                        canEditGroupManualStatus({
                                          actorRole: groupRole,
                                          actorUserId: session.user.id,
                                          targetUserId: assignedPlayer,
                                          targetMembershipRole: membershipRole
                                        })
                                      const assignedUnavailable = isParticipantUnavailableForTeams(assignedPlayer)
                                      const moveEntries = Array.from(
                                        { length: modeConfig.teams },
                                        (_, ti) => {
                                          const list = teamAssignments[ti] || []
                                          const isCurrentTeam = list.includes(assignedPlayer)
                                          const isTeamFull =
                                            list.length >= modeConfig.players_per_team
                                          const isDisabled =
                                            assignedUnavailable ||
                                            positionLockedHere ||
                                            isCurrentTeam ||
                                            isTeamFull
                                          return { teamIndex: ti, isDisabled }
                                        }
                                      )
                                      const swapIds = []
                                      for (const list of Object.values(teamAssignments)) {
                                        for (const pid of list || []) {
                                          if (!pid || pid === assignedPlayer) continue
                                          if (!loadoutHasAnyFilled(loadouts[pid])) continue
                                          if (!swapIds.includes(pid)) swapIds.push(pid)
                                        }
                                      }
                                      swapIds.sort((a, b) =>
                                        labelForParticipant(a).localeCompare(labelForParticipant(b))
                                      )
                                      const hasLoadoutToClear = loadoutHasAnyFilled(
                                        loadouts[assignedPlayer]
                                      )
                                      const allAssignedLoadoutItemsLocked = (() => {
                                        const locks = lockedLoadouts[assignedPlayer]
                                        if (!locks) return false
                                        const gadgetsLocked =
                                          Array.isArray(locks.gadgets) &&
                                          locks.gadgets.length === 3 &&
                                          locks.gadgets.every(Boolean)
                                        return !!(
                                          locks.class &&
                                          locks.specialization &&
                                          locks.weapon &&
                                          gadgetsLocked
                                        )
                                      })()
                                      const menuOpen = assignedSlotMenuKey === slotMenuKey
                                      if (isViewOnlyMode && session?.user?.id !== assignedPlayer)
                                        return null

                                      return (
                                        <div className="player-name-row__actions">
                                          {!isViewOnlyMode ? (
                                            <div className="player-actions">
                                              <button
                                                className={`player-randomize-btn ${positionLockedHere ? 'disabled' : ''}`}
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  if (!positionLockedHere) {
                                                    handleRandomizePlayerLoadout(assignedPlayer)
                                                  }
                                                }}
                                                disabled={positionLockedHere}
                                                title={
                                                  positionLockedHere
                                                    ? 'Unlock player to randomize loadout'
                                                    : "Randomize this player's loadout"
                                                }
                                              >
                                                <DiceIcon />
                                              </button>
                                            </div>
                                          ) : null}
                                          <div
                                            className="assigned-slot-actions-wrap"
                                            data-assigned-slot-menu-wrap={slotMenuKey}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            onPointerDown={(e) => e.stopPropagation()}
                                          >
                                            <button
                                              type="button"
                                              className="participant-item__menu-trigger"
                                              aria-haspopup="menu"
                                              aria-expanded={menuOpen}
                                              aria-controls={
                                                menuOpen
                                                  ? `assigned-slot-menu-${slotMenuKey}`
                                                  : undefined
                                              }
                                              aria-label={`Actions for ${labelForParticipant(assignedPlayer)}`}
                                              onClick={(e) => {
                                                const triggerRect =
                                                  e.currentTarget.getBoundingClientRect()
                                                assignedSlotMenuTriggerRectRef.current = triggerRect
                                                setAssignedSlotMenuKey((open) =>
                                                  open === slotMenuKey ? null : slotMenuKey
                                                )
                                                setAssignedSlotMenuMoveSubOpen(false)
                                                setAssignedSlotMenuSwapSubOpen(false)
                                                if (assignedSlotMenuKey === slotMenuKey) {
                                                  setAssignedSlotMenuPosition(null)
                                                } else {
                                                  setAssignedSlotMenuPosition({
                                                    top: triggerRect.bottom + MENU_TRIGGER_GAP,
                                                    left: triggerRect.right
                                                  })
                                                }
                                              }}
                                            >
                                              <ParticipantMenuDotsIcon />
                                            </button>
                                            {menuOpen ? (
                                              <div
                                                ref={assignedSlotMenuRef}
                                                className="participant-actions-menu"
                                                id={`assigned-slot-menu-${slotMenuKey}`}
                                                role="menu"
                                                style={
                                                  assignedSlotMenuPosition
                                                    ? {
                                                        position: 'fixed',
                                                        top: `${assignedSlotMenuPosition.top}px`,
                                                        left: `${assignedSlotMenuPosition.left}px`,
                                                        right: 'auto',
                                                        marginTop: 0,
                                                        transform: 'translateX(-100%)',
                                                        ...(assignedSlotMenuPosition.maxHeight != null
                                                          ? {
                                                              maxHeight:
                                                                assignedSlotMenuPosition.maxHeight,
                                                              overflowY:
                                                                assignedSlotMenuPosition.overflowY ||
                                                                'auto'
                                                            }
                                                          : {})
                                                      }
                                                    : undefined
                                                }
                                              >
                                                {isViewOnlyMode || canEditAssignedManualStatus ? (
                                                  <button
                                                    type="button"
                                                    role="menuitem"
                                                    className="participant-actions-menu__item"
                                                    disabled={
                                                      !activeGroupId || assignedUnavailable
                                                    }
                                                    title={
                                                      !activeGroupId
                                                        ? 'Join or select a group to change availability'
                                                        : assignedUnavailable
                                                          ? 'Already unavailable'
                                                          : undefined
                                                    }
                                                    onClick={() => {
                                                      if (!activeGroupId || assignedUnavailable)
                                                        return
                                                      handleGroupManualStatusChange(
                                                        assignedPlayer,
                                                        'unavailable'
                                                      )
                                                      closeAssignedSlotMenu()
                                                    }}
                                                  >
                                                    Set unavailable
                                                  </button>
                                                ) : null}
                                                {!isViewOnlyMode ? (
                                                  <div className="participant-actions-menu__sub-host">
                                                  <button
                                                    type="button"
                                                    role="menuitem"
                                                    className="participant-actions-menu__item participant-actions-menu__item--with-chevron"
                                                    aria-haspopup="true"
                                                    aria-expanded={
                                                      assignedSlotMenuMoveSubOpen && menuOpen
                                                    }
                                                    disabled={
                                                      assignedUnavailable || positionLockedHere
                                                    }
                                                    title={
                                                      positionLockedHere
                                                        ? 'Unlock position to move between teams'
                                                        : undefined
                                                    }
                                                    onClick={() => {
                                                      if (assignedUnavailable || positionLockedHere)
                                                        return
                                                      setAssignedSlotMenuMoveSubOpen((s) => !s)
                                                      setAssignedSlotMenuSwapSubOpen(false)
                                                    }}
                                                  >
                                                    <span>Move player</span>
                                                    <ChevronRightIcon />
                                                  </button>
                                                  {assignedSlotMenuMoveSubOpen ? (
                                                    <div
                                                      className="participant-actions-menu__sub"
                                                      role="presentation"
                                                      style={assignedSlotSubmenuStyle}
                                                    >
                                                      {moveEntries.map((entry) => (
                                                        <button
                                                          key={entry.teamIndex}
                                                          type="button"
                                                          role="menuitem"
                                                          className={[
                                                            'participant-actions-menu__item',
                                                            'participant-actions-menu__sub-item',
                                                            entry.isDisabled && 'is-disabled'
                                                          ]
                                                            .filter(Boolean)
                                                            .join(' ')}
                                                          disabled={entry.isDisabled}
                                                          onClick={() => {
                                                            if (entry.isDisabled) return
                                                            handleAssignToTeam(
                                                              assignedPlayer,
                                                              entry.teamIndex
                                                            )
                                                            closeAssignedSlotMenu()
                                                          }}
                                                        >
                                                          {gameConfig.teams?.[entry.teamIndex]
                                                            ?.name || `Team ${entry.teamIndex + 1}`}
                                                        </button>
                                                      ))}
                                                    </div>
                                                  ) : null}
                                                  </div>
                                                ) : null}
                                                {!isViewOnlyMode ? (
                                                  <button
                                                    type="button"
                                                    role="menuitem"
                                                    className="participant-actions-menu__item"
                                                    disabled={positionLockedHere}
                                                    title={
                                                      positionLockedHere
                                                        ? 'Unlock player to randomize loadout'
                                                        : undefined
                                                    }
                                                    onClick={() => {
                                                      if (positionLockedHere) return
                                                      handleRandomizePlayerLoadout(assignedPlayer)
                                                      closeAssignedSlotMenu()
                                                    }}
                                                  >
                                                    Randomize loadout
                                                  </button>
                                                ) : null}
                                                {!isViewOnlyMode ? (
                                                  <button
                                                    type="button"
                                                    role="menuitem"
                                                    className="participant-actions-menu__item"
                                                    onClick={() => {
                                                      handleToggleAllLoadoutLocks(assignedPlayer)
                                                      closeAssignedSlotMenu()
                                                    }}
                                                  >
                                                    {allAssignedLoadoutItemsLocked
                                                      ? 'Unlock items'
                                                      : 'Lock items'}
                                                  </button>
                                                ) : null}
                                                {!isViewOnlyMode ? (
                                                  <button
                                                    type="button"
                                                    role="menuitem"
                                                    className="participant-actions-menu__item"
                                                    onClick={() => {
                                                      toggleParticipantPositionLock(
                                                        assignedPlayer,
                                                        teamIndex
                                                      )
                                                      closeAssignedSlotMenu()
                                                    }}
                                                  >
                                                    {positionLockedHere
                                                      ? 'Unlock position'
                                                      : 'Lock position'}
                                                  </button>
                                                ) : null}
                                                {!isViewOnlyMode ? (
                                                  <button
                                                    type="button"
                                                    role="menuitem"
                                                    className="participant-actions-menu__item"
                                                    disabled={!hasLoadoutToClear}
                                                    title={
                                                      !hasLoadoutToClear
                                                        ? 'Loadout is already empty'
                                                        : undefined
                                                    }
                                                    onClick={() => {
                                                      if (!hasLoadoutToClear) return
                                                      handleClearPlayerLoadout(assignedPlayer)
                                                      closeAssignedSlotMenu()
                                                    }}
                                                  >
                                                    Clear loadout
                                                  </button>
                                                ) : null}
                                                {!isViewOnlyMode ? (
                                                  <div className="participant-actions-menu__sub-host">
                                                    <button
                                                      type="button"
                                                      role="menuitem"
                                                      className="participant-actions-menu__item participant-actions-menu__item--with-chevron"
                                                      aria-haspopup="true"
                                                      aria-expanded={
                                                        assignedSlotMenuSwapSubOpen && menuOpen
                                                      }
                                                      disabled={swapIds.length === 0}
                                                      title={
                                                        swapIds.length === 0
                                                          ? 'No other assigned players with a loadout'
                                                          : undefined
                                                      }
                                                      onClick={() => {
                                                        if (swapIds.length === 0) return
                                                        setAssignedSlotMenuSwapSubOpen((s) => !s)
                                                        setAssignedSlotMenuMoveSubOpen(false)
                                                      }}
                                                    >
                                                      <span>Swap loadout</span>
                                                      <ChevronRightIcon />
                                                    </button>
                                                    {assignedSlotMenuSwapSubOpen ? (
                                                      <div
                                                        className="participant-actions-menu__sub"
                                                        role="presentation"
                                                        style={assignedSlotSubmenuStyle}
                                                      >
                                                        {swapIds.map((otherId) => (
                                                          <button
                                                            key={otherId}
                                                            type="button"
                                                            role="menuitem"
                                                            className="participant-actions-menu__item participant-actions-menu__sub-item"
                                                            onClick={() => {
                                                              handleSwapPlayerLoadouts(
                                                                assignedPlayer,
                                                                otherId
                                                              )
                                                              closeAssignedSlotMenu()
                                                            }}
                                                          >
                                                            {labelForParticipant(otherId)}
                                                          </button>
                                                        ))}
                                                      </div>
                                                    ) : null}
                                                  </div>
                                                ) : null}
                                              </div>
                                            ) : null}
                                          </div>
                                        </div>
                                      )
                                    })()}
                                </div>
                                <div className="loadout-display">
                                  {/* Class */}
                                  <div className="loadout-item-wrapper">
                                    <div 
                                      className={`loadout-item class-item ${!loadouts[assignedPlayer]?.class ? 'empty' : ''} ${lockedLoadouts[assignedPlayer]?.class ? 'locked' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (!isViewOnlyMode && !lockedLoadouts[assignedPlayer]?.class) {
                                          setLoadoutSelector({ participant: assignedPlayer, type: 'class' })
                                        }
                                      }}
                                    >
                                      {loadouts[assignedPlayer]?.class ? (
                                        <>
                                          <img 
                                            src={gameConfig.class_images[loadouts[assignedPlayer].class]} 
                                            alt={loadouts[assignedPlayer].class}
                                            className="class-image"
                                          />
                                          <button
                                            className="loadout-randomize-btn-inside class-randomize"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              handleRandomizeSingleLoadoutItem(assignedPlayer, 'class')
                                            }}
                                            title="Randomize class"
                                          >
                                            <SmallDiceIcon />
                                          </button>
                                          {!isViewOnlyMode ? (
                                            <button
                                              className="loadout-lock-btn-inside class-lock"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                handleToggleLoadoutLock(assignedPlayer, 'class')
                                              }}
                                              title={lockedLoadouts[assignedPlayer]?.class ? 'Click to unlock' : 'Click to lock'}
                                            >
                                              {lockedLoadouts[assignedPlayer]?.class ? <LockIcon /> : <UnlockIcon />}
                                            </button>
                                          ) : lockedLoadouts[assignedPlayer]?.class ? (
                                            <span className="loadout-lock-indicator-inside class-lock" title="Class locked">
                                              <PositionLockIcon />
                                            </span>
                                          ) : null}
                                        </>
                                      ) : (
                                        <span className="loadout-item-text">Class</span>
                                      )}
                                    </div>
                                    <div className={`loadout-item-label ${getLoadoutLabelClass(loadouts[assignedPlayer]?.class || 'Class')}`}>
                                      <em>{loadouts[assignedPlayer]?.class || 'Class'}</em>
                                    </div>
                                  </div>
                                  
                                  {/* Specialization */}
                                  <div className="loadout-item-wrapper">
                                    <div 
                                      className={`loadout-item spec-item ${!loadouts[assignedPlayer]?.specialization ? 'empty' : ''} ${lockedLoadouts[assignedPlayer]?.specialization ? 'locked' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (!isViewOnlyMode && !lockedLoadouts[assignedPlayer]?.specialization) {
                                          setLoadoutSelector({ participant: assignedPlayer, type: 'specialization' })
                                        }
                                      }}
                                    >
                                      {loadouts[assignedPlayer]?.specialization ? (
                                        <>
                                          {loadouts[assignedPlayer].specialization.imageFile ? (
                                            <img 
                                              src={loadouts[assignedPlayer].specialization.imageFile} 
                                              alt={loadouts[assignedPlayer].specialization.name}
                                              className="spec-image"
                                              onError={(e) => {
                                                console.error('Failed to load spec image:', loadouts[assignedPlayer].specialization.imageFile)
                                                e.target.style.display = 'none'
                                              }}
                                            />
                                          ) : (
                                            <span className="loadout-item-text">{loadouts[assignedPlayer].specialization.name}</span>
                                          )}
                                          <button
                                            className="loadout-randomize-btn-inside spec-randomize"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              handleRandomizeSingleLoadoutItem(assignedPlayer, 'specialization')
                                            }}
                                            title="Randomize specialization"
                                          >
                                            <SmallDiceIcon />
                                          </button>
                                          {!isViewOnlyMode ? (
                                            <button
                                              className="loadout-lock-btn-inside spec-lock"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                handleToggleLoadoutLock(assignedPlayer, 'specialization')
                                              }}
                                              title={lockedLoadouts[assignedPlayer]?.specialization ? 'Click to unlock' : 'Click to lock'}
                                            >
                                              {lockedLoadouts[assignedPlayer]?.specialization ? <LockIcon /> : <UnlockIcon />}
                                            </button>
                                          ) : lockedLoadouts[assignedPlayer]?.specialization ? (
                                            <span className="loadout-lock-indicator-inside spec-lock" title="Specialization locked">
                                              <PositionLockIcon />
                                            </span>
                                          ) : null}
                                      </>
                                    ) : (
                                      <span className="loadout-item-text">Spec</span>
                                    )}
                                    </div>
                                    <div className={`loadout-item-label ${getLoadoutLabelClass(loadouts[assignedPlayer]?.specialization?.name || 'Spec')}`}>
                                      <em>{loadouts[assignedPlayer]?.specialization?.name || 'Spec'}</em>
                                    </div>
                                  </div>
                                  
                                  {/* Weapon */}
                                  <div className="loadout-item-wrapper">
                                    <div 
                                      className={`loadout-item weapon-item ${!loadouts[assignedPlayer]?.weapon ? 'empty' : ''} ${lockedLoadouts[assignedPlayer]?.weapon ? 'locked' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (!isViewOnlyMode && !lockedLoadouts[assignedPlayer]?.weapon) {
                                          setLoadoutSelector({ participant: assignedPlayer, type: 'weapon' })
                                        }
                                      }}
                                    >
                                      {loadouts[assignedPlayer]?.weapon ? (
                                        <>
                                          {loadouts[assignedPlayer].weapon.imageFile ? (
                                            <img 
                                              src={loadouts[assignedPlayer].weapon.imageFile} 
                                              alt={loadouts[assignedPlayer].weapon.name}
                                              className="weapon-image"
                                              onError={(e) => {
                                                console.error('Failed to load weapon image:', loadouts[assignedPlayer].weapon.imageFile)
                                                e.target.style.display = 'none'
                                              }}
                                            />
                                          ) : (
                                            <span className="loadout-item-text">{loadouts[assignedPlayer].weapon.name}</span>
                                          )}
                                          <button
                                            className="loadout-randomize-btn-inside weapon-randomize"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              handleRandomizeSingleLoadoutItem(assignedPlayer, 'weapon')
                                            }}
                                            title="Randomize weapon"
                                          >
                                            <SmallDiceIcon />
                                          </button>
                                          {!isViewOnlyMode ? (
                                            <button
                                              className="loadout-lock-btn-inside weapon-lock"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                handleToggleLoadoutLock(assignedPlayer, 'weapon')
                                              }}
                                              title={lockedLoadouts[assignedPlayer]?.weapon ? 'Click to unlock' : 'Click to lock'}
                                            >
                                              {lockedLoadouts[assignedPlayer]?.weapon ? <LockIcon /> : <UnlockIcon />}
                                            </button>
                                          ) : lockedLoadouts[assignedPlayer]?.weapon ? (
                                            <span className="loadout-lock-indicator-inside weapon-lock" title="Weapon locked">
                                              <PositionLockIcon />
                                            </span>
                                          ) : null}
                                      </>
                                    ) : (
                                      <span className="loadout-item-text">Weapon</span>
                                    )}
                                    </div>
                                    <div className={`loadout-item-label ${getLoadoutLabelClass(loadouts[assignedPlayer]?.weapon?.name || 'Weapon')}`}>
                                      <em>{loadouts[assignedPlayer]?.weapon?.name || 'Weapon'}</em>
                                    </div>
                                  </div>
                                  
                                  {/* 3 Gadgets */}
                                  {[0, 1, 2].map(idx => (
                                    <div key={idx} className="loadout-item-wrapper">
                                      <div 
                                        className={`loadout-item gadget-item ${!loadouts[assignedPlayer]?.gadgets?.[idx] ? 'empty' : ''} ${lockedLoadouts[assignedPlayer]?.gadgets?.[idx] ? 'locked' : ''}`}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          if (!isViewOnlyMode && !lockedLoadouts[assignedPlayer]?.gadgets?.[idx]) {
                                            setLoadoutSelector({ participant: assignedPlayer, type: 'gadget', index: idx })
                                          }
                                        }}
                                      >
                                        {loadouts[assignedPlayer]?.gadgets?.[idx] ? (
                                          <>
                                            {loadouts[assignedPlayer].gadgets[idx].imageFile ? (
                                              <img 
                                                src={loadouts[assignedPlayer].gadgets[idx].imageFile} 
                                                alt={loadouts[assignedPlayer].gadgets[idx].name}
                                                className="gadget-image"
                                                onError={(e) => {
                                                  console.error('Failed to load gadget image:', loadouts[assignedPlayer].gadgets[idx].imageFile)
                                                  e.target.style.display = 'none'
                                                }}
                                              />
                                            ) : (
                                              <span className="loadout-item-text">{loadouts[assignedPlayer].gadgets[idx].name}</span>
                                            )}
                                            <button
                                              className="loadout-randomize-btn-inside gadget-randomize"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                handleRandomizeSingleLoadoutItem(assignedPlayer, 'gadget', idx)
                                              }}
                                              title="Randomize gadget"
                                            >
                                              <SmallDiceIcon />
                                            </button>
                                            {!isViewOnlyMode ? (
                                              <button
                                                className="loadout-lock-btn-inside gadget-lock"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  handleToggleLoadoutLock(assignedPlayer, 'gadget', idx)
                                                }}
                                                title={lockedLoadouts[assignedPlayer]?.gadgets?.[idx] ? 'Click to unlock' : 'Click to lock'}
                                              >
                                                {lockedLoadouts[assignedPlayer]?.gadgets?.[idx] ? <LockIcon /> : <UnlockIcon />}
                                              </button>
                                            ) : lockedLoadouts[assignedPlayer]?.gadgets?.[idx] ? (
                                              <span className="loadout-lock-indicator-inside gadget-lock" title={`Gadget ${idx + 1} locked`}>
                                                <PositionLockIcon />
                                              </span>
                                            ) : null}
                                        </>
                                      ) : (
                                        <span className="loadout-item-text">Gadget</span>
                                      )}
                                      </div>
                                      <div className={`loadout-item-label ${getLoadoutLabelClass(loadouts[assignedPlayer]?.gadgets?.[idx]?.name || `Gadget ${idx + 1}`)}`}>
                                        <em>{loadouts[assignedPlayer]?.gadgets?.[idx]?.name || `Gadget ${idx + 1}`}</em>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <span className="slot-placeholder">Empty</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {/* Available participants that can be assigned */}
                    {!isViewOnlyMode &&
                      participants.filter(
                        (p) =>
                          !Object.values(teamAssignments).flat().includes(p) &&
                          !isParticipantUnavailableForTeams(p)
                      ).length > 0 && (
                      <div className="assign-options">
                        <p>Assign:</p>
                        {participants
                          .filter(
                            (p) =>
                              !Object.values(teamAssignments).flat().includes(p) &&
                              !isParticipantUnavailableForTeams(p)
                          )
                          .map((id) => (
                            <button
                              key={id}
                              className="assign-btn"
                              onClick={() => handleAssignToTeam(id, teamIndex)}
                              disabled={
                                teamAssignments[teamIndex]?.length >= modeConfig.players_per_team ||
                                isParticipantUnavailableForTeams(id)
                              }
                            >
                              {labelForParticipant(id)}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )); })()}
              </DynamicLayoutRoot>
            )}
          </div>
          </div>
          </section>
        </div>
      </main>

      {isUserSettingsModalOpen && (
        <div className="modal-overlay" onClick={() => setIsUserSettingsModalOpen(false)}>
          <div
            className="modal-content user-settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-settings-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="user-settings-modal-title">User settings</h2>
              <button className="modal-close-btn" onClick={() => setIsUserSettingsModalOpen(false)} aria-label="Close modal">
                <FontAwesomeIcon icon={faXmark} className={`${FA_ICON_CLASS} modal-close-icon`} aria-hidden />
              </button>
            </div>
            <div className="modal-body user-settings-modal-body">
              {session?.user?.id ? (
                <UserSettingsPanel
                  userId={session.user.id}
                  initialUsername={profileDisplayName}
                  currentEmail={session.user.email || ''}
                  onProfileUpdated={loadSelfProfile}
                />
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsModalOpen(false)}>
          <div className="modal-content settings-page-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Settings</h2>
              <div className="settings-header-actions">
                <button
                  className="randomize-all-btn settings-randomize-weights-btn"
                  onClick={handleRandomizeSettingsWeights}
                  disabled={settingsTargetIsReadOnly}
                >
                  <DiceIcon />
                  Randomize Weights
                </button>
                <button className="modal-close-btn" onClick={() => setIsSettingsModalOpen(false)} aria-label="Close modal">
                  <FontAwesomeIcon icon={faXmark} className={`${FA_ICON_CLASS} modal-close-icon`} aria-hidden />
                </button>
              </div>
            </div>
            <div className="settings-overrides-topbar">
              <label htmlFor="settings-override-select" className="settings-overrides-label">Override</label>
              <select
                id="settings-override-select"
                className="settings-overrides-select"
                value={settingsTargetPlayer}
                onChange={(e) => handleSettingsTargetChange(e.target.value)}
              >
                <option value={SETTINGS_ALL_PLAYERS}>Default</option>
                {participants.map((id) => {
                  const hasOverride = !!playerOverrides[id]
                  const label = labelForParticipant(id)
                  return (
                    <option
                      key={id}
                      value={id}
                      style={hasOverride ? undefined : { color: 'var(--app-select-option-muted)' }}
                    >
                      {hasOverride ? label : `${label} (default weights)`}
                    </option>
                  )
                })}
              </select>
              <button
                className="settings-override-set-all-btn"
                onClick={handleSetAllWeightsToOne}
                disabled={settingsTargetIsReadOnly}
              >
                Set All 1
              </button>
              <button
                className="settings-override-delete-btn"
                onClick={handleDeleteSelectedOverride}
                disabled={!hasSelectedOverride}
              >
                Delete
              </button>
            </div>
            <div className="modal-body settings-page-body">
              <div className="settings-page-layout">
                <div className="settings-config-panel">
              <h3 className="settings-section-title">Classes</h3>
              <div className="weapons-settings-grid settings-top-classes-grid">
                {classesList.map((classItem) => (
                  <div className={`weapon-settings-card ${getDisplayEnabledValue('classEnabled', classItem.key) ? '' : 'disabled'}`} key={classItem.key}>
                    <div className="loadout-item-wrapper settings-weapon-wrapper">
                      <div
                        className={`loadout-item class-item settings-weapon-preview ${getDisplayEnabledValue('classEnabled', classItem.key) ? '' : 'disabled'}`}
                        onClick={() => {
                          if (!settingsTargetIsReadOnly) {
                            updateSettingsMapValue('classEnabled', classItem.key, !getDisplayEnabledValue('classEnabled', classItem.key))
                          }
                        }}
                      >
                        <label className="weapon-enable-checkbox" title="Enable/disable this class in randomizer">
                          <input
                            type="checkbox"
                            checked={getDisplayEnabledValue('classEnabled', classItem.key)}
                            onChange={(e) => updateSettingsMapValue('classEnabled', classItem.key, e.target.checked)}
                            onClick={(e) => e.stopPropagation()}
                            disabled={settingsTargetIsReadOnly}
                          />
                        </label>
                        {classItem.imageFile ? (
                          <img
                            src={classItem.imageFile}
                            alt={classItem.name}
                            className="class-image"
                          />
                        ) : (
                          <span className="loadout-item-text">{classItem.name}</span>
                        )}
                      </div>
                      <div className={`loadout-item-label ${getLoadoutLabelClass(classItem.name)}`}>
                        <em>{classItem.name}</em>
                      </div>
                    </div>
                    <div className="settings-weight-row">
                      <input
                        className="weapon-settings-input"
                        type="text"
                        placeholder="Value"
                        value={getDisplayInputValue('classInputs', classItem.key) ?? '1'}
                        onChange={(e) => updateSettingsMapValue('classInputs', classItem.key, e.target.value)}
                        onBlur={(e) => {
                          if (e.target.value.trim() === '') {
                            updateSettingsMapValue('classInputs', classItem.key, '1')
                          }
                        }}
                        disabled={settingsTargetIsReadOnly}
                      />
                      <span
                        className={`settings-weight-percent ${getDisplayEnabledValue('classEnabled', classItem.key) ? '' : 'is-zero'}`}
                        title="Weight share among enabled items"
                      >
                        {formatPercent(
                          getSettingsWeightPercent(
                            'classInputs',
                            'classEnabled',
                            classItem.key,
                            classesList.map((item) => item.key)
                          )
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <h3 className="settings-section-title">Specializations</h3>
              {specializationsByClass.map(({ className, specializations }) => (
                <section key={className} className="settings-class-section">
                  <div className={`settings-class-title ${className}`}>
                    {className.charAt(0).toUpperCase() + className.slice(1)}
                  </div>
                  <div className="weapons-settings-grid">
                    {specializations.map((specialization) => (
                      <div className={`weapon-settings-card ${getDisplayEnabledValue('specializationEnabled', specialization.key) ? '' : 'disabled'}`} key={specialization.key}>
                        <div className="loadout-item-wrapper settings-weapon-wrapper">
                          <div
                            className={`loadout-item spec-item settings-weapon-preview ${getDisplayEnabledValue('specializationEnabled', specialization.key) ? '' : 'disabled'}`}
                            onClick={() => {
                              if (!settingsTargetIsReadOnly) {
                                updateSettingsMapValue('specializationEnabled', specialization.key, !getDisplayEnabledValue('specializationEnabled', specialization.key))
                              }
                            }}
                          >
                            <label className="weapon-enable-checkbox" title="Enable/disable this specialization in randomizer">
                              <input
                                type="checkbox"
                                checked={getDisplayEnabledValue('specializationEnabled', specialization.key)}
                                onChange={(e) => updateSettingsMapValue('specializationEnabled', specialization.key, e.target.checked)}
                                onClick={(e) => e.stopPropagation()}
                                disabled={settingsTargetIsReadOnly}
                              />
                            </label>
                            {specialization.imageFile ? (
                              <img
                                src={specialization.imageFile}
                                alt={specialization.name}
                                className="spec-image"
                              />
                            ) : (
                              <span className="loadout-item-text">{specialization.name}</span>
                            )}
                          </div>
                          <div className={`loadout-item-label ${getLoadoutLabelClass(specialization.name)}`}>
                            <em>{specialization.name}</em>
                          </div>
                        </div>
                        <div className="settings-weight-row">
                          <input
                            className="weapon-settings-input"
                            type="text"
                            placeholder="Value"
                            value={getDisplayInputValue('specializationInputs', specialization.key) ?? '1'}
                            onChange={(e) => updateSettingsMapValue('specializationInputs', specialization.key, e.target.value)}
                            onBlur={(e) => {
                              if (e.target.value.trim() === '') {
                                updateSettingsMapValue('specializationInputs', specialization.key, '1')
                              }
                            }}
                            disabled={settingsTargetIsReadOnly}
                          />
                          <span
                            className={`settings-weight-percent ${getDisplayEnabledValue('specializationEnabled', specialization.key) ? '' : 'is-zero'}`}
                            title="Weight share among enabled items"
                          >
                            {formatPercent(
                              getSettingsWeightPercent(
                                'specializationInputs',
                                'specializationEnabled',
                                specialization.key,
                                specializations.map((item) => item.key)
                              )
                            )}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}

              <h3 className="settings-section-title">Weapons</h3>
              {weaponsByClass.map(({ className, weapons }) => (
                <section key={className} className="settings-class-section">
                  <div className={`settings-class-title ${className}`}>
                    {className.charAt(0).toUpperCase() + className.slice(1)}
                  </div>
                  <div className="weapons-settings-grid">
                    {weapons.map((weapon) => (
                      <div className={`weapon-settings-card ${getDisplayEnabledValue('weaponEnabled', weapon.key) ? '' : 'disabled'}`} key={weapon.key}>
                        <div className="loadout-item-wrapper settings-weapon-wrapper">
                          <div
                            className={`loadout-item weapon-item settings-weapon-preview ${getDisplayEnabledValue('weaponEnabled', weapon.key) ? '' : 'disabled'}`}
                            onClick={() => {
                              if (!settingsTargetIsReadOnly) {
                                updateSettingsMapValue('weaponEnabled', weapon.key, !getDisplayEnabledValue('weaponEnabled', weapon.key))
                              }
                            }}
                          >
                            <label className="weapon-enable-checkbox" title="Enable/disable this weapon in randomizer">
                              <input
                                type="checkbox"
                                checked={getDisplayEnabledValue('weaponEnabled', weapon.key)}
                                onChange={(e) => updateSettingsMapValue('weaponEnabled', weapon.key, e.target.checked)}
                                onClick={(e) => e.stopPropagation()}
                                disabled={settingsTargetIsReadOnly}
                              />
                            </label>
                            {weapon.imageFile ? (
                              <img
                                src={weapon.imageFile}
                                alt={weapon.name}
                                className="weapon-image"
                              />
                            ) : (
                              <span className="loadout-item-text">{weapon.name}</span>
                            )}
                          </div>
                          <div className={`loadout-item-label ${getLoadoutLabelClass(weapon.name)}`}>
                            <em>{weapon.name}</em>
                          </div>
                        </div>
                        <div className="settings-weight-row">
                          <input
                            className="weapon-settings-input"
                            type="text"
                            placeholder="Value"
                            value={getDisplayInputValue('weaponInputs', weapon.key) ?? '1'}
                            onChange={(e) => updateSettingsMapValue('weaponInputs', weapon.key, e.target.value)}
                            onBlur={(e) => {
                              if (e.target.value.trim() === '') {
                                updateSettingsMapValue('weaponInputs', weapon.key, '1')
                              }
                            }}
                            disabled={settingsTargetIsReadOnly}
                          />
                          <span
                            className={`settings-weight-percent ${getDisplayEnabledValue('weaponEnabled', weapon.key) ? '' : 'is-zero'}`}
                            title="Weight share among enabled items"
                          >
                            {formatPercent(
                              getSettingsWeightPercent(
                                'weaponInputs',
                                'weaponEnabled',
                                weapon.key,
                                weapons.map((item) => item.key)
                              )
                            )}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}

              <h3 className="settings-section-title">Gadgets</h3>
              {gadgetsByClass.map(({ className, gadgets }) => (
                <section key={className} className="settings-class-section">
                  <div className={`settings-class-title ${className}`}>
                    {className.charAt(0).toUpperCase() + className.slice(1)}
                  </div>
                  <div className="weapons-settings-grid">
                    {gadgets.map((gadget) => {
                      const isModeForcedDisabled = isGadgetForcedDisabledForMode(className, gadget.name)
                      const isGadgetEnabled = getDisplayEnabledValue('gadgetEnabled', gadget.key)
                      return (
                      <div className={`weapon-settings-card ${isGadgetEnabled && !isModeForcedDisabled ? '' : 'disabled'}`} key={gadget.key}>
                        <div className="loadout-item-wrapper settings-weapon-wrapper">
                          <div
                            className={`loadout-item gadget-item settings-weapon-preview ${isGadgetEnabled && !isModeForcedDisabled ? '' : 'disabled'}`}
                            onClick={() => {
                              if (!settingsTargetIsReadOnly && !isModeForcedDisabled) {
                                updateSettingsMapValue('gadgetEnabled', gadget.key, !isGadgetEnabled)
                              }
                            }}
                          >
                            <label className="weapon-enable-checkbox" title="Enable/disable this gadget in randomizer">
                              <input
                                type="checkbox"
                                checked={!isModeForcedDisabled && isGadgetEnabled}
                                onChange={(e) => updateSettingsMapValue('gadgetEnabled', gadget.key, e.target.checked)}
                                onClick={(e) => e.stopPropagation()}
                                disabled={settingsTargetIsReadOnly || isModeForcedDisabled}
                              />
                            </label>
                            {gadget.imageFile ? (
                              <img
                                src={gadget.imageFile}
                                alt={gadget.name}
                                className="gadget-image"
                              />
                            ) : (
                              <span className="loadout-item-text">{gadget.name}</span>
                            )}
                          </div>
                          <div className={`loadout-item-label ${getLoadoutLabelClass(gadget.name)}`}>
                            <em>{gadget.name}</em>
                          </div>
                        </div>
                        <div className="settings-weight-row">
                          <input
                            className="weapon-settings-input"
                            type="text"
                            placeholder="Value"
                            value={getDisplayInputValue('gadgetInputs', gadget.key) ?? '1'}
                            onChange={(e) => updateSettingsMapValue('gadgetInputs', gadget.key, e.target.value)}
                            onBlur={(e) => {
                              if (e.target.value.trim() === '') {
                                updateSettingsMapValue('gadgetInputs', gadget.key, '1')
                              }
                            }}
                            disabled={settingsTargetIsReadOnly}
                          />
                          <span
                            className={`settings-weight-percent ${isGadgetEnabled && !isModeForcedDisabled ? '' : 'is-zero'}`}
                            title="Weight share among enabled items"
                          >
                            {formatPercent(
                              getSettingsWeightPercent(
                                'gadgetInputs',
                                'gadgetEnabled',
                                gadget.key,
                                gadgets.map((item) => item.key)
                              )
                            )}
                          </span>
                        </div>
                      </div>
                    )})}
                  </div>
                </section>
              ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Team Settings Modal */}
      {isTeamSettingsModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTeamSettingsModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Team Settings</h2>
              <button className="modal-close-btn" onClick={() => setIsTeamSettingsModalOpen(false)} aria-label="Close modal">
                <FontAwesomeIcon icon={faXmark} className={`${FA_ICON_CLASS} modal-close-icon`} aria-hidden />
              </button>
            </div>
            <div className="modal-body">
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={balancedTeams}
                  onChange={(e) => setBalancedTeams(e.target.checked)}
                />
                <span>Balanced Teams</span>
              </label>
              <p className="settings-description">
                When enabled, teams will be balanced evenly. When disabled, players are randomly assigned using dice rolls.
              </p>

              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={fillFirst}
                  onChange={(e) => setFillFirst(e.target.checked)}
                />
                <span>Fill First</span>
              </label>
              <p className="settings-description">
                When enabled, the randomizer will attempt to fill teams completely before moving to the next team. Uses the minimum number of teams needed to hold all players.
              </p>

              <div className="keep-separate-section">
                <h3>Keep Separate</h3>
                <p className="settings-description">
                  Players in these pairs will be placed on opposite teams whenever possible.
                </p>
                <div className="keep-separate-add-row">
                  <select
                    value={keepSeparateA}
                    onChange={(e) => setKeepSeparateA(e.target.value)}
                    disabled={participants.length < 2}
                  >
                    {participants.map((id) => (
                      <option key={`a-${id}`} value={id}>
                        {labelForParticipant(id)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={keepSeparateB}
                    onChange={(e) => setKeepSeparateB(e.target.value)}
                    disabled={participants.length < 2}
                  >
                    {participants
                      .filter((id) => id !== keepSeparateA)
                      .map((id) => (
                        <option key={`b-${id}`} value={id}>
                          {labelForParticipant(id)}
                        </option>
                      ))}
                  </select>
                  <button
                    className="randomize-btn"
                    onClick={handleAddKeepSeparatePair}
                    disabled={participants.length < 2 || !keepSeparateA || !keepSeparateB || keepSeparateA === keepSeparateB}
                  >
                    Add
                  </button>
                </div>
                <div className="keep-separate-list">
                  {keepSeparatePairs.length === 0 ? (
                    <p className="empty-state">No keep separate pairs yet</p>
                  ) : (
                    keepSeparatePairs.map((pair) => (
                      <div key={pair.id} className="participant-item">
                        <span>
                          {labelForParticipant(pair.playerA)} vs {labelForParticipant(pair.playerB)}
                        </span>
                        <button onClick={() => handleRemoveKeepSeparatePair(pair.id)}>×</button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loadout Selector Modal */}
      {loadoutSelector && (
        <div className="modal-overlay" onClick={() => setLoadoutSelector(null)}>
          <div className="modal-content loadout-selector-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                Select {loadoutSelector.type === 'class' ? 'Class' : 
                       loadoutSelector.type === 'specialization' ? 'Specialization' : 
                       loadoutSelector.type === 'weapon' ? 'Weapon' : 'Gadget'}
              </h2>
              <button className="modal-close-btn" onClick={() => setLoadoutSelector(null)} aria-label="Close modal">
                <FontAwesomeIcon icon={faXmark} className={`${FA_ICON_CLASS} modal-close-icon`} aria-hidden />
              </button>
            </div>
            <div className="modal-body loadout-selector-body">
              {loadoutSelector.type === 'class' && (
                <div className="selector-options">
                  {classesList.map((classItem) =>
                    renderSelectorOptionCard({
                      key: classItem.key,
                      label: classItem.name,
                      imageFile: classItem.imageFile,
                      itemType: 'class',
                      onSelect: () => handleLoadoutSelect(classItem.key)
                    })
                  )}
                </div>
              )}
              {loadoutSelector.type === 'specialization' && !loadouts[loadoutSelector.participant]?.class && (
                <div className="selector-options">
                  {specializationsByClass.flatMap(({ className, specializations }) =>
                    specializations.map((spec) =>
                      renderSelectorOptionCard({
                        key: `${className}-${spec.name}`,
                        label: `${spec.name} (${className})`,
                        imageFile: spec.imageFile,
                        itemType: 'spec',
                        disabled: true,
                        title: 'Select a class first to choose a specialization'
                      })
                    )
                  )}
                </div>
              )}
              {loadoutSelector.type === 'specialization' && loadouts[loadoutSelector.participant]?.class && (
                <div className="selector-options">
                  {(gameConfig.classes[loadouts[loadoutSelector.participant].class]?.specializations || []).map((spec) =>
                    renderSelectorOptionCard({
                      key: spec.name,
                      label: spec.name,
                      imageFile: spec.imageFile,
                      itemType: 'spec',
                      onSelect: () => handleLoadoutSelect(spec)
                    })
                  )}
                </div>
              )}
              {loadoutSelector.type === 'weapon' && !loadouts[loadoutSelector.participant]?.class && (
                <div className="selector-options">
                  {weaponsByClass.flatMap(({ className, weapons }) =>
                    weapons.map((weapon) =>
                      renderSelectorOptionCard({
                        key: `${className}-${weapon.name}`,
                        label: `${weapon.name} (${className})`,
                        imageFile: weapon.imageFile,
                        itemType: 'weapon',
                        disabled: true,
                        title: 'Select a class first to choose a weapon'
                      })
                    )
                  )}
                </div>
              )}
              {loadoutSelector.type === 'weapon' && loadouts[loadoutSelector.participant]?.class && (
                <div className="selector-options">
                  {(gameConfig.classes[loadouts[loadoutSelector.participant].class]?.weapons || []).map((weapon) =>
                    renderSelectorOptionCard({
                      key: weapon.name,
                      label: weapon.name,
                      imageFile: weapon.imageFile,
                      itemType: 'weapon',
                      onSelect: () => handleLoadoutSelect(weapon)
                    })
                  )}
                </div>
              )}
              {loadoutSelector.type === 'gadget' && !loadouts[loadoutSelector.participant]?.class && (
                <div className="selector-options">
                  {gadgetsByClass.flatMap(({ className, gadgets }) =>
                    gadgets.map((gadget) =>
                      renderSelectorOptionCard({
                        key: `${className}-${gadget.name}`,
                        label: `${gadget.name} (${className})`,
                        imageFile: gadget.imageFile,
                        itemType: 'gadget',
                        disabled: true,
                        title: 'Select a class first to choose a gadget'
                      })
                    )
                  )}
                </div>
              )}
              {loadoutSelector.type === 'gadget' && loadouts[loadoutSelector.participant]?.class && (
                <div className="selector-options">
                  {gameConfig.classes[loadouts[loadoutSelector.participant].class]?.gadgets
                    ?.filter(gadget => {
                      // Filter out already selected gadgets (unless it's the current slot)
                      const currentGadgets = loadouts[loadoutSelector.participant]?.gadgets || []
                      return !currentGadgets.some((g, i) => g && g.name === gadget.name && i !== loadoutSelector.index)
                    })
                    ?.map((gadget) =>
                      renderSelectorOptionCard({
                        key: gadget.name,
                        label: gadget.name,
                        imageFile: gadget.imageFile,
                        itemType: 'gadget',
                        onSelect: () => handleLoadoutSelect(gadget)
                      })
                    )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default App
