import { useState, useEffect, useRef, useMemo } from 'react'
import './App.css'
import './layouts.css'
import gameConfig from '../game-config.json'
import mapsConfig from '../maps-config.json'
import { computeDynamicLayout } from './layoutEngine'
import { supabase } from './lib/supabaseClient'
import { fetchPersistedState, savePersistedState } from './services/stateStore'
import {
  fetchUserRole,
  signInWithEmail,
  signUpWithEmail,
  signOut as authSignOut
} from './services/authService'

const STATE_VERSION = '1.0.0'
const SETTINGS_ALL_PLAYERS = '__all_players__'
const SIDEBAR_OVERLAY_BREAKPOINT = 1440
const SUPABASE_STATE_TABLE = import.meta.env.VITE_SUPABASE_STATE_TABLE || 'loadout_states'
const SUPABASE_STATE_PROFILE = import.meta.env.VITE_SUPABASE_STATE_PROFILE || 'default'
const REMOTE_APPLY_SUPPRESS_MS = 500

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

// Icon Components
const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
)

const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
  </svg>
)

const UnlockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
    <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
  </svg>
)

const RemoveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
)

const MinusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
)

const SmallDiceIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    <circle cx="8" cy="8" r="1.5" fill="currentColor"></circle>
    <circle cx="16" cy="16" r="1.5" fill="currentColor"></circle>
    <circle cx="8" cy="16" r="1.5" fill="currentColor"></circle>
    <circle cx="16" cy="8" r="1.5" fill="currentColor"></circle>
    <circle cx="12" cy="12" r="1.5" fill="currentColor"></circle>
  </svg>
)

const DiceIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    <circle cx="8" cy="8" r="1.5" fill="currentColor"></circle>
    <circle cx="16" cy="16" r="1.5" fill="currentColor"></circle>
    <circle cx="8" cy="16" r="1.5" fill="currentColor"></circle>
    <circle cx="16" cy="8" r="1.5" fill="currentColor"></circle>
    <circle cx="12" cy="12" r="1.5" fill="currentColor"></circle>
  </svg>
)

const ModeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="8" width="18" height="8" rx="4"></rect>
    <line x1="8" y1="8" x2="8" y2="5"></line>
    <line x1="16" y1="8" x2="16" y2="5"></line>
  </svg>
)

const MapIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"></path>
    <line x1="9" y1="4" x2="9" y2="20"></line>
    <line x1="15" y1="6" x2="15" y2="22"></line>
  </svg>
)

const WeatherIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"></path>
    <line x1="8" y1="19" x2="8.01" y2="19"></line>
    <line x1="12" y1="19" x2="12.01" y2="19"></line>
    <line x1="16" y1="19" x2="16.01" y2="19"></line>
  </svg>
)

const RefreshIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"></polyline>
    <polyline points="1 20 1 14 7 14"></polyline>
    <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10M1 14l5.36 4.36A9 9 0 0 0 20.49 15"></path>
  </svg>
)

const ChevronLeftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"></polyline>
  </svg>
)

const ChevronRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
)

function App() {
  const [selectedGamemode, setSelectedGamemode] = useState(null)
  const [selectedMapId, setSelectedMapId] = useState(null) // e.g., "bernal__standard"
  const [selectedWeather, setSelectedWeather] = useState(null)
  const [selectedLoadoutRandomTarget, setSelectedLoadoutRandomTarget] = useState('')
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [userRole, setUserRole] = useState(null)
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authMode, setAuthMode] = useState('signin')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [lockedGamemode, setLockedGamemode] = useState(false)
  const [lockedMap, setLockedMap] = useState(false)
  const [lockedWeather, setLockedWeather] = useState(false)
  const [lockedLoadoutRandomTarget, setLockedLoadoutRandomTarget] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isSidebarOverlayMode, setIsSidebarOverlayMode] = useState(
    () => window.innerWidth < SIDEBAR_OVERLAY_BREAKPOINT
  )
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [participants, setParticipants] = useState([])
  const [newParticipant, setNewParticipant] = useState('')
  const [teamAssignments, setTeamAssignments] = useState({})
  const [lockedParticipants, setLockedParticipants] = useState({}) // { participantName: teamIndex }
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [isTeamSettingsModalOpen, setIsTeamSettingsModalOpen] = useState(false)
  const [balancedTeams, setBalancedTeams] = useState(true)
  const [fillFirst, setFillFirst] = useState(false)
  const [keepSeparatePairs, setKeepSeparatePairs] = useState([])
  const [keepSeparateA, setKeepSeparateA] = useState('')
  const [keepSeparateB, setKeepSeparateB] = useState('')
  const [loadouts, setLoadouts] = useState({}) // { participantName: { class, specialization, weapon, gadgets: [] } }
  const [lockedLoadouts, setLockedLoadouts] = useState({}) // { participantName: { class: true/false, specialization: true/false, weapon: true/false, gadgets: [true/false] } }
  const [loadoutSelector, setLoadoutSelector] = useState(null) // { participant, type, index } or null
  const [removeConfirmation, setRemoveConfirmation] = useState(null) // { participant, teamIndex } or null
  const [excludedItems, setExcludedItems] = useState({}) // { participantName: { class: [], specialization: { _global: [], light: [], medium: [], heavy: [] }, weapon: { _global: [], light: [], medium: [], heavy: [] }, gadget: { _global: [], light: [], medium: [], heavy: [] } } }
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
  const isInitialLoad = useRef(true)
  const skipNextPersistRef = useRef(false)
  const suppressPersistUntilRef = useRef(0)
  const lastPersistedStateRef = useRef('')
  const teamsPanelRef = useRef(null)
  const isViewOnlyMode = userRole !== 'admin'

  const gamemodes = Object.keys(gameConfig.gamemodes)
  const loadoutRandomTargets = ['Weapon', 'Specialization', '2 Gadgets']

  const applyPersistedState = (parsed) => {
    if (parsed.selectedGamemode !== undefined) setSelectedGamemode(parsed.selectedGamemode)
    if (parsed.participants !== undefined) setParticipants(parsed.participants)
    if (parsed.teamAssignments !== undefined) setTeamAssignments(parsed.teamAssignments)
    if (parsed.lockedParticipants !== undefined) setLockedParticipants(parsed.lockedParticipants)
    if (parsed.balancedTeams !== undefined) setBalancedTeams(parsed.balancedTeams)
    if (parsed.fillFirst !== undefined) setFillFirst(parsed.fillFirst)
    if (parsed.keepSeparatePairs !== undefined) setKeepSeparatePairs(parsed.keepSeparatePairs)
    if (parsed.loadouts) setLoadouts(parsed.loadouts)
    if (parsed.lockedLoadouts) setLockedLoadouts(parsed.lockedLoadouts)
    if (parsed.excludedItems !== undefined) setExcludedItems(parsed.excludedItems)
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
    if (parsed.selectedLoadoutRandomTarget !== undefined) setSelectedLoadoutRandomTarget(parsed.selectedLoadoutRandomTarget)
    if (parsed.lockedGamemode !== undefined) setLockedGamemode(parsed.lockedGamemode)
    if (parsed.lockedMap !== undefined) setLockedMap(parsed.lockedMap)
    if (parsed.lockedWeather !== undefined) setLockedWeather(parsed.lockedWeather)
    if (parsed.lockedLoadoutRandomTarget !== undefined) setLockedLoadoutRandomTarget(parsed.lockedLoadoutRandomTarget)
    if (parsed.isSidebarCollapsed !== undefined) setIsSidebarCollapsed(parsed.isSidebarCollapsed)
  }

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true)
      setSession(null)
      setUserRole(null)
      return
    }

    let mounted = true

    const syncRole = async (user) => {
      if (!user) {
        if (mounted) setUserRole(null)
        return
      }
      try {
        const role = await fetchUserRole(user.id)
        if (mounted) setUserRole(role)
      } catch (error) {
        console.error('[Auth] Failed to load role:', error)
        if (mounted) setUserRole('view')
      }
    }

    const init = async () => {
      const {
        data: { session: initialSession }
      } = await supabase.auth.getSession()
      if (!mounted) return
      setSession(initialSession)
      await syncRole(initialSession?.user ?? null)
      setAuthReady(true)
    }

    init()

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      setUserRole(null)
      await syncRole(nextSession?.user ?? null)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  // Load persisted state once signed in (RLS requires authentication)
  useEffect(() => {
    if (!session?.user || !userRole) {
      isInitialLoad.current = true
      return
    }

    let isCancelled = false

    const loadState = async () => {
      try {
        const parsed = await fetchPersistedState()
        if (!parsed || isCancelled) return

        if (parsed.version !== STATE_VERSION) {
          console.warn('[State] Ignoring persisted state due to version mismatch')
          return
        }
        lastPersistedStateRef.current = stableSerialize(parsed)
        skipNextPersistRef.current = true
        suppressPersistUntilRef.current = Date.now() + REMOTE_APPLY_SUPPRESS_MS
        applyPersistedState(parsed)
      } catch (error) {
        console.error('[State] Error loading persisted state:', error)
      } finally {
        if (!isCancelled) {
          isInitialLoad.current = false
        }
      }
    }

    loadState()

    return () => {
      isCancelled = true
    }
  }, [session?.user, userRole])

  // Save state to Supabase whenever it changes (but not during initial load)
  useEffect(() => {
    if (isInitialLoad.current) return
    if (userRole !== 'admin') return
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false
      return
    }

    const stateToSave = {
      version: STATE_VERSION,
      selectedGamemode,
      selectedMapId,
      selectedWeather,
      selectedLoadoutRandomTarget,
      lockedGamemode,
      lockedMap,
      lockedWeather,
      lockedLoadoutRandomTarget,
      isSidebarCollapsed,
      participants,
      teamAssignments,
      lockedParticipants,
      balancedTeams,
      fillFirst,
      keepSeparatePairs,
      loadouts,
      lockedLoadouts,
      excludedItems,
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

    const serializedState = stableSerialize(stateToSave)
    if (serializedState === lastPersistedStateRef.current) return

    savePersistedState(stateToSave)
      .then(() => {
        // Mark as persisted only after successful write.
        lastPersistedStateRef.current = serializedState
      })
      .catch((error) => {
        console.error('[State] Error saving persisted state:', error)
      })
  }, [userRole, selectedGamemode, selectedMapId, selectedWeather, selectedLoadoutRandomTarget, lockedGamemode, lockedMap, lockedWeather, lockedLoadoutRandomTarget, isSidebarCollapsed, participants, teamAssignments, lockedParticipants, balancedTeams, fillFirst, keepSeparatePairs, loadouts, lockedLoadouts, excludedItems, classInputs, classEnabled, specializationInputs, specializationEnabled, weaponInputs, weaponEnabled, gadgetInputs, gadgetEnabled, playerOverrides])

  useEffect(() => {
    if (!supabase || !session?.user) return

    let isMounted = true
    const channel = supabase
      .channel('loadout-state-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: SUPABASE_STATE_TABLE,
          filter: `profile_key=eq.${SUPABASE_STATE_PROFILE}`
        },
        async () => {
          if (!isMounted) return
          try {
            const latest = await fetchPersistedState()
            if (!latest || latest.version !== STATE_VERSION) return

            const serializedLatest = stableSerialize(latest)
            if (serializedLatest === lastPersistedStateRef.current) return

            lastPersistedStateRef.current = serializedLatest
            skipNextPersistRef.current = true
            suppressPersistUntilRef.current = Date.now() + REMOTE_APPLY_SUPPRESS_MS
            applyPersistedState(latest)
          } catch (error) {
            console.error('[Realtime] Failed to sync state update:', error)
          }
        }
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
  }, [session?.user])

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
    // On narrow screens, sidebar starts closed by default.
    if (isSidebarOverlayMode) {
      setIsSidebarCollapsed(true)
    }
  }, [isSidebarOverlayMode])

  useEffect(() => {
    if (!isViewOnlyMode) return
    setIsSidebarCollapsed(true)
    setIsSettingsModalOpen(false)
    setIsTeamSettingsModalOpen(false)
    setLoadoutSelector(null)
    setRemoveConfirmation(null)
  }, [isViewOnlyMode])

  const handleAuthSubmit = async () => {
    if (!supabase) {
      setAuthError('Supabase is not configured (URL / anon key).')
      return
    }
    setAuthError('')
    const email = authEmail.trim()
    const password = authPassword
    if (!email || !password) {
      setAuthError('Enter email and password.')
      return
    }
    setAuthBusy(true)
    try {
      if (authMode === 'signup') {
        const { session: newSession } = await signUpWithEmail(email, password)
        if (!newSession) {
          setAuthError('Check your email to confirm your account, then sign in.')
          return
        }
      } else {
        await signInWithEmail(email, password)
      }
      setAuthPassword('')
    } catch (err) {
      setAuthError(err.message || 'Authentication failed.')
    } finally {
      setAuthBusy(false)
    }
  }

  const handleSignOut = async () => {
    setAuthError('')
    try {
      await authSignOut()
    } catch (err) {
      setAuthError(err.message || 'Sign out failed.')
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
  }, [selectedGamemode])

  useEffect(() => {
    const isAnyModalOpen =
      isSettingsModalOpen ||
      isTeamSettingsModalOpen ||
      !!loadoutSelector ||
      !!removeConfirmation

    if (!isAnyModalOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isSettingsModalOpen, isTeamSettingsModalOpen, loadoutSelector, removeConfirmation])

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

  useEffect(() => {
    const panelEl = teamsPanelRef.current
    if (!panelEl) return

    const updateOrientation = () => {
      const rect = panelEl.getBoundingClientRect()
      const measuredWidth = Math.round(rect.width) || panelEl.clientWidth || panelEl.offsetWidth || 0
      const measuredHeight = Math.round(rect.height) || panelEl.clientHeight || panelEl.offsetHeight || 0
      const width = Math.max(0, measuredWidth)
      const height = Math.max(0, measuredHeight)
      setIsTeamsPanelPortrait(height > width)
      setTeamsPanelWidth(width)
      setTeamsPanelHeight(height)
    }

    updateOrientation()
    const timeoutId = setTimeout(updateOrientation, 0)

    let observer = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => updateOrientation())
      observer.observe(panelEl)
    }

    window.addEventListener('resize', updateOrientation)
    return () => {
      clearTimeout(timeoutId)
      if (observer) observer.disconnect()
      window.removeEventListener('resize', updateOrientation)
    }
  }, [selectedGamemode])

  const handleAddParticipant = () => {
    if (newParticipant.trim() && !participants.includes(newParticipant.trim())) {
      setParticipants([...participants, newParticipant.trim()])
      setNewParticipant('')
    }
  }

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

  const handleRemoveParticipant = (name) => {
    setParticipants(participants.filter(p => p !== name))
    // Remove from team assignments
    const updatedAssignments = { ...teamAssignments }
    Object.keys(updatedAssignments).forEach(teamIndex => {
      updatedAssignments[teamIndex] = updatedAssignments[teamIndex].filter(p => p !== name)
    })
    setTeamAssignments(updatedAssignments)
    // Remove lock
    const updatedLocks = { ...lockedParticipants }
    delete updatedLocks[name]
    setLockedParticipants(updatedLocks)
    // Remove loadout
    const updatedLoadouts = { ...loadouts }
    delete updatedLoadouts[name]
    setLoadouts(updatedLoadouts)
    // Remove locked loadout
    const updatedLockedLoadouts = { ...lockedLoadouts }
    delete updatedLockedLoadouts[name]
    setLockedLoadouts(updatedLockedLoadouts)
    // Remove excluded items
    const updatedExcludedItems = { ...excludedItems }
    delete updatedExcludedItems[name]
    setExcludedItems(updatedExcludedItems)
  }

  const handleAssignToTeam = (participant, teamIndex) => {
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

  const handleRemoveFromTeamClick = (participant, teamIndex) => {
    // Don't remove if locked
    if (lockedParticipants[participant] === teamIndex) {
      return
    }
    // Show confirmation modal
    setRemoveConfirmation({ participant, teamIndex })
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

  const handleConfirmRemove = () => {
    if (!removeConfirmation) return
    const { participant, teamIndex } = removeConfirmation
    const updatedAssignments = { ...teamAssignments }
    updatedAssignments[teamIndex] = updatedAssignments[teamIndex].filter(p => p !== participant)
    setTeamAssignments(updatedAssignments)
    // Also remove from participants list completely (don't send back to list)
    setParticipants(participants.filter(p => p !== participant))
    // Also remove their loadout and locked loadouts
    const newLoadouts = { ...loadouts }
    delete newLoadouts[participant]
    setLoadouts(newLoadouts)
    const newLockedLoadouts = { ...lockedLoadouts }
    delete newLockedLoadouts[participant]
    setLockedLoadouts(newLockedLoadouts)
    // Also remove from locked participants
    const newLockedParticipants = { ...lockedParticipants }
    delete newLockedParticipants[participant]
    setLockedParticipants(newLockedParticipants)
    // Also remove excluded items
    const newExcludedItems = { ...excludedItems }
    delete newExcludedItems[participant]
    setExcludedItems(newExcludedItems)
    // Close modal
    setRemoveConfirmation(null)
  }

  const handleToggleLock = (e, participant, teamIndex) => {
    e.stopPropagation() // Prevent removing from team when clicking lock
    const updatedLocks = { ...lockedParticipants }
    if (updatedLocks[participant] === teamIndex) {
      // Unlock
      delete updatedLocks[participant]
    } else {
      // Lock to this team
      updatedLocks[participant] = teamIndex
    }
    setLockedParticipants(updatedLocks)
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

  const handleRandomizeTeams = () => {
    if (!selectedGamemode || participants.length === 0) return

    const mode = gameConfig.gamemodes[selectedGamemode]
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
    const unlockedParticipants = participants.filter(p => lockedParticipants[p] === undefined)
    const shuffledUnlocked = shuffleArray(unlockedParticipants)

    // Calculate minimum teams needed if fillFirst is enabled
    const minTeamsNeeded = fillFirst ? Math.ceil(unlockedParticipants.length / playersPerTeam) : numTeams
    const teamsToUse = Math.min(minTeamsNeeded, numTeams)

    // Fill teams with unlocked participants
    if (balancedTeams) {
      // Balanced: round-robin fashion
      for (let slotIndex = 0; slotIndex < playersPerTeam && shuffledUnlocked.length > 0; slotIndex++) {
        for (let teamIndex = 0; teamIndex < teamsToUse && shuffledUnlocked.length > 0; teamIndex++) {
          // Skip if this team is full or this slot is reserved for a locked player
          if (teamSlotsUsed[teamIndex] >= playersPerTeam) continue
          
          // If slot doesn't exist or is null, add the participant
          if (!newAssignments[teamIndex][slotIndex]) {
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
      }
    } else {
      // Unbalanced: dice roll for each participant
      shuffledUnlocked.forEach((participant) => {
        const teamsWithSpace = []
        const conflictFreeTeams = []

        for (let teamIndex = 0; teamIndex < teamsToUse; teamIndex++) {
          if (teamSlotsUsed[teamIndex] >= playersPerTeam) continue
          teamsWithSpace.push(teamIndex)
          if (!teamHasConflict(teamIndex, participant, newAssignments)) {
            conflictFreeTeams.push(teamIndex)
          }
        }

        const candidateTeams = conflictFreeTeams.length > 0 ? conflictFreeTeams : teamsWithSpace
        if (candidateTeams.length === 0) return

        const randomTeamIndex = candidateTeams[Math.floor(Math.random() * candidateTeams.length)]
        newAssignments[randomTeamIndex].push(participant)
        teamSlotsUsed[randomTeamIndex]++
      })

      // Check if all unlocked participants ended up on one team
      // If so, move the last player to another team
      const teamsWithPlayers = Object.keys(newAssignments).filter(teamIndex => 
        newAssignments[teamIndex] && newAssignments[teamIndex].length > 0
      )
      
      if (teamsWithPlayers.length === 1 && shuffledUnlocked.length > 1) {
        // All players are on one team - move the last player
        const teamWithAllPlayers = parseInt(teamsWithPlayers[0])
        const lastPlayer = newAssignments[teamWithAllPlayers].pop()
        teamSlotsUsed[teamWithAllPlayers]--
        
        // Find another team with space
        let moved = false
        for (let i = 0; i < teamsToUse && !moved; i++) {
          if (i !== teamWithAllPlayers && teamSlotsUsed[i] < playersPerTeam) {
            newAssignments[i].push(lastPlayer)
            teamSlotsUsed[i]++
            moved = true
          }
        }
        
        // If still couldn't move (shouldn't happen), put them back
        if (!moved) {
          newAssignments[teamWithAllPlayers].push(lastPlayer)
          teamSlotsUsed[teamWithAllPlayers]++
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

    setTeamAssignments(compactedAssignments)
    setLockedParticipants(updatedLocks)
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

  const handleRandomizeLoadouts = () => {
    // Get all assigned players (people who could have loadouts)
    const allAssignedPlayers = Object.values(teamAssignments).flat()
    if (allAssignedPlayers.length === 0 && participants.length === 0) return

    const classNames = Object.keys(gameConfig.classes) // ['light', 'medium', 'heavy']
    const newLoadouts = { ...loadouts }

    // Iterate over all assigned players and unassigned participants
    const allPlayers = [...new Set([...allAssignedPlayers, ...participants])]
    
    allPlayers.forEach(participant => {
      // Skip if player card is locked
      if (lockedParticipants[participant] !== undefined) {
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
          .filter(className => !isItemExcluded(participant, 'class', null, className))
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
          .filter(spec => !isItemExcluded(participant, 'specialization', selectedClass, spec.name))
          .filter(spec => isSpecializationEnabledForRandomizer(participant, selectedClass, spec.name))
        currentLoadout.specialization = getWeightedRandomItem(
          specializations,
          (spec) => getSpecializationWeight(participant, selectedClass, spec.name)
        )
      }

      // Randomly select a weapon (if not locked)
      if (!locks.weapon) {
        const weapons = (classData.weapons || [])
          .filter(weapon => !isItemExcluded(participant, 'weapon', selectedClass, weapon.name))
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
        .filter(g => !isItemExcluded(participant, 'gadget', selectedClass, g.name))
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

    setLoadouts(newLoadouts)
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
        .filter(className => !isItemExcluded(participant, 'class', null, className))
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
        .filter(spec => !isItemExcluded(participant, 'specialization', selectedClass, spec.name))
        .filter(spec => isSpecializationEnabledForRandomizer(participant, selectedClass, spec.name))
      currentLoadout.specialization = getWeightedRandomItem(
        specializations,
        (spec) => getSpecializationWeight(participant, selectedClass, spec.name)
      )
    }

    // Randomly select a weapon (if not locked)
    if (!locks.weapon) {
      const weapons = (classData.weapons || [])
        .filter(weapon => !isItemExcluded(participant, 'weapon', selectedClass, weapon.name))
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
        .filter(g => !isItemExcluded(participant, 'gadget', selectedClass, g.name))
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

  // Toggle exclude state for an item (per participant)
  const handleToggleExclude = (participant, type, className, itemName) => {
    setExcludedItems(prev => {
      const participantExclusions = prev[participant] || {
        class: [],
        specialization: { _global: [], light: [], medium: [], heavy: [] },
        weapon: { _global: [], light: [], medium: [], heavy: [] },
        gadget: { _global: [], light: [], medium: [], heavy: [] }
      }
      
      if (type === 'class') {
        const isExcluded = participantExclusions.class.includes(itemName)
        return {
          ...prev,
          [participant]: {
            ...participantExclusions,
            class: isExcluded
              ? participantExclusions.class.filter(name => name !== itemName)
              : [...participantExclusions.class, itemName]
          }
        }
      } else {
        // Use '_global' key if className is null or undefined (no class selected)
        const excludeKey = className || '_global'
        const classExcluded = participantExclusions[type]?.[excludeKey] || []
        const isExcluded = classExcluded.includes(itemName)
        return {
          ...prev,
          [participant]: {
            ...participantExclusions,
            [type]: {
              ...participantExclusions[type],
              [excludeKey]: isExcluded
                ? classExcluded.filter(name => name !== itemName)
                : [...classExcluded, itemName]
            }
          }
        }
      }
    })
  }

  // Check if an item is excluded (for a specific participant)
  const isItemExcluded = (participant, type, className, itemName) => {
    const participantExclusions = excludedItems[participant]
    if (!participantExclusions) return false
    
    if (type === 'class') {
      return participantExclusions.class.includes(itemName)
    }
    // Check global exclusion first
    const globallyExcluded = participantExclusions[type]?._global?.includes(itemName) || false
    if (globallyExcluded) return true
    // Then check class-specific exclusion if className is provided
    if (className) {
      return participantExclusions[type]?.[className]?.includes(itemName) || false
    }
    return false
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
  const isGadgetEnabledForRandomizer = (participant, className, gadgetName) =>
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
        .filter((className) => !isItemExcluded(participant, 'class', null, className))
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
        .filter((spec) => !isItemExcluded(participant, 'specialization', selectedClass, spec.name))
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
        .filter((weapon) => !isItemExcluded(participant, 'weapon', selectedClass, weapon.name))
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
        .filter((gadget) => !isItemExcluded(participant, 'gadget', selectedClass, gadget.name))
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
    if (!lockedGamemode) {
      handleRandomizeGamemode()
    }
    // Small delay to let gamemode update
    setTimeout(() => {
      if (!lockedMap) {
        handleRandomizeMap()
      }
      setTimeout(() => {
        if (!lockedWeather) {
          handleRandomizeWeather()
        }
      }, 50)
    }, 50)
    if (!lockedLoadoutRandomTarget) {
      handleRandomizeLoadoutRandomTarget()
    }
    handleRandomizeTeams()
    handleRandomizeLoadouts()
  }

  // Get selected map's modifier and display name
  const getMapDisplayName = () => {
    if (!selectedMapId) return '-- Select a map --'
    const mapDetails = getMapDetails(selectedMapId)
    if (!mapDetails) return selectedMapId.replace('__', ' - ').replace(/_/g, ' ')
    return `${mapDetails.map.replace(/_/g, ' ')} - ${mapDetails.modifier}`
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
  const selectedMapDetails = getMapDetails(selectedMapId)
  const unassignedParticipantsCount = useMemo(() => {
    const assignedParticipants = new Set(Object.values(teamAssignments).flat().filter(Boolean))
    return participants.reduce((count, name) => (assignedParticipants.has(name) ? count : count + 1), 0)
  }, [participants, teamAssignments])
  const effectiveUnassignedParticipantsCount = isViewOnlyMode ? 0 : unassignedParticipantsCount
  const normalizedGamemode = (selectedGamemode || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  const isTdmFamilyMode =
    normalizedGamemode === 'team_deathmatch' ||
    normalizedGamemode === 'power_shift'
  const isDynamicLayoutMode =
    modeConfig?.players_per_team === 3 ||
    modeConfig?.players_per_team === 5 ||
    modeConfig?.players_per_team === 8
  const isTeamDeathmatchMode = isTdmFamilyMode && !isDynamicLayoutMode
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
  }, [isDynamicLayoutMode, teamsPanelWidth, teamsPanelHeight, viewportWidth, effectiveUnassignedParticipantsCount, participants.length, teamAssignments, isViewOnlyMode])

  const computedDynamicLayout = useMemo(
    () =>
      isDynamicLayoutMode
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
        : null,
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
      dynamicLayoutRuntimeMetrics.assignOptionsReserve
    ]
  )
  const dynamicLayoutClasses = computedDynamicLayout
    ? [
        'is-dynamic-layout',
        `layout-team-${computedDynamicLayout.teamGrid.rows}x${computedDynamicLayout.teamGrid.cols}`,
        `layout-player-${computedDynamicLayout.playerGrid.rows}x${computedDynamicLayout.playerGrid.cols}`,
        `layout-loadout-${computedDynamicLayout.loadoutGrid.rows}x${computedDynamicLayout.loadoutGrid.cols}`
      ]
    : []
  const dynamicLayoutLabelBaseFontSize = computedDynamicLayout
    ? Math.max(14, Math.min(22, Math.round(computedDynamicLayout.itemSize * 0.16)))
    : null
  const dynamicLayoutLabelMediumFontSize =
    dynamicLayoutLabelBaseFontSize !== null ? Math.max(13, dynamicLayoutLabelBaseFontSize - 1) : null
  const dynamicLayoutLabelLongFontSize =
    dynamicLayoutLabelBaseFontSize !== null ? Math.max(12, dynamicLayoutLabelBaseFontSize - 2) : null
  const dynamicLayoutStyle = computedDynamicLayout
    ? {
        '--layout-team-rows': `${computedDynamicLayout.teamGrid.rows}`,
        '--layout-team-cols': `${computedDynamicLayout.teamGrid.cols}`,
        '--layout-player-rows': `${computedDynamicLayout.playerGrid.rows}`,
        '--layout-player-cols': `${computedDynamicLayout.playerGrid.cols}`,
        '--layout-loadout-rows': `${computedDynamicLayout.loadoutGrid.rows}`,
        '--layout-loadout-cols': `${computedDynamicLayout.loadoutGrid.cols}`,
        '--layout-item-size': `${computedDynamicLayout.itemSize}px`,
        '--layout-label-height': `${computedDynamicLayout.labelHeight}px`,
        '--layout-slot-width': `${Math.ceil(computedDynamicLayout.slotRequiredWidth)}px`,
        '--layout-slot-height': `${Math.ceil(computedDynamicLayout.slotRequiredHeight)}px`,
        '--layout-player-grid-width': `${Math.ceil(computedDynamicLayout.playerGridWidth)}px`,
        '--layout-player-grid-height': `${Math.ceil(computedDynamicLayout.playerGridHeight)}px`,
        '--layout-team-block-width': `${Math.ceil(computedDynamicLayout.teamBlockWidth)}px`,
        '--layout-team-block-height': `${Math.ceil(computedDynamicLayout.teamBlockHeight)}px`,
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

  if (!authReady) {
    return (
      <div className="access-gate-page">
        <div className="access-gate-card">
          <h1 className="access-gate-title">The Finals Customs</h1>
          <p className="access-gate-help">Loading…</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="access-gate-page">
        <div className="access-gate-card">
          <h1 className="access-gate-title">The Finals Customs</h1>
          <p className="access-gate-help">
            {authMode === 'signin' ? 'Sign in with your email.' : 'Create an account (viewer by default).'}
          </p>
          <input
            type="email"
            value={authEmail}
            onChange={(e) => {
              setAuthEmail(e.target.value)
              if (authError) setAuthError('')
            }}
            placeholder="Email"
            className="access-auth-input"
            autoComplete="email"
            autoFocus
          />
          <input
            type="password"
            value={authPassword}
            onChange={(e) => {
              setAuthPassword(e.target.value)
              if (authError) setAuthError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAuthSubmit()
              }
            }}
            placeholder="Password"
            className="access-auth-input access-auth-password"
            autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
          />
          {authError && <p className="access-modal-error">{authError}</p>}
          <div className="access-modal-actions access-auth-actions">
            <button className="randomize-btn" type="button" onClick={handleAuthSubmit} disabled={authBusy}>
              {authMode === 'signin' ? 'Sign in' : 'Sign up'}
            </button>
            <button
              type="button"
              className="access-mode-toggle-btn"
              onClick={() => {
                setAuthMode((m) => (m === 'signin' ? 'signup' : 'signin'))
                setAuthError('')
              }}
            >
              {authMode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (userRole === null) {
    return (
      <div className="access-gate-page">
        <div className="access-gate-card">
          <h1 className="access-gate-title">The Finals Customs</h1>
          <p className="access-gate-help">Loading your access…</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`App ${isViewOnlyMode ? 'is-view-only' : ''}`}>
      <header className="App-header">
        <h1 className="app-title">The Finals Customs</h1>
        {/* Top Right Controls */}
        <div className="top-right-controls">
          {!isViewOnlyMode && selectedGamemode && participants.length > 0 && (
            <button 
              className="randomize-all-btn" 
              onClick={handleRandomizeAll}
            >
              <DiceIcon />
              <span className="randomize-all-label">Randomize All</span>
            </button>
          )}
          {!isViewOnlyMode && (
            <button
              className="top-right-settings-btn"
              onClick={() => setIsSettingsModalOpen(true)}
              title="Open settings"
              aria-label="Open settings"
            >
              <SettingsIcon />
            </button>
          )}
          <button
            type="button"
            className="sign-out-btn"
            onClick={handleSignOut}
            title="Sign out"
            aria-label="Sign out"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="App-main">
        <div className={`app-workspace ${isSidebarOverlayMode ? 'sidebar-overlay-mode' : ''}`}>
          {!isViewOnlyMode && isSidebarOverlayMode && !isSidebarCollapsed && (
            <div className="sidebar-collapsed-spacer" aria-hidden="true" />
          )}
          {!isViewOnlyMode && isSidebarOverlayMode && !isSidebarCollapsed && (
            <button
              className="sidebar-overlay-backdrop"
              onClick={() => setIsSidebarCollapsed(true)}
              aria-label="Close sidebar overlay"
              title="Close sidebar overlay"
            />
          )}
          <aside className={`app-sidebar ${isSidebarCollapsed || isViewOnlyMode ? 'is-collapsed' : ''} ${isSidebarOverlayMode && !isSidebarCollapsed && !isViewOnlyMode ? 'is-overlay' : ''}`}>
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
            {isSidebarCollapsed || isViewOnlyMode ? (
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
                      <span className="collapsed-summary-value collapsed-weather-lines">
                        <span>{selectedMapDetails.modifier}</span>
                        <span>{selectedWeather}</span>
                      </span>
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
            {/* Game Mode, Map, and Weather Selectors */}
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
                    {availableMaps.map(mapId => {
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
                    {selectedMapDetails?.weather?.map(weather => (
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
                    onClick={() => setLockedWeather(!lockedWeather)}
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

            {/* Randomize Buttons */}
            {selectedGamemode && participants.length > 0 && (
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

            {/* Participants Panel */}
            <div className="participants-panel">
              <div className="participants-header">
                <h2>Participants</h2>
                <button
                  className="settings-icon-btn"
                  onClick={() => setIsTeamSettingsModalOpen(true)}
                  title="Team Settings"
                >
                  <SettingsIcon />
                </button>
              </div>
              <div className="add-participant">
                <input
                  type="text"
                  value={newParticipant}
                  onChange={(e) => setNewParticipant(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddParticipant()}
                  placeholder="Enter participant name"
                />
                <button onClick={handleAddParticipant}>Add</button>
              </div>
              <div className="participants-list">
                {participants.length === 0 ? (
                  <p className="empty-state">No participants added yet</p>
                ) : (() => {
                  const assignedParticipants = Object.values(teamAssignments).flat()
                  const unassignedParticipants = participants.filter(name => !assignedParticipants.includes(name))
                  return unassignedParticipants.length === 0 ? (
                    <p className="empty-state">All participants assigned to teams</p>
                  ) : (
                    unassignedParticipants.map(name => (
                      <div key={name} className="participant-item">
                        <span>{name}</span>
                        <button onClick={() => handleRemoveParticipant(name)}>×</button>
                      </div>
                    ))
                  )
                })()}
              </div>
            </div>
              </>
            )}
          </aside>

          <section className="app-content">
            {/* Main Content Area */}
            <div className="main-content">
          {/* Team Builds Panel */}
          <div className="teams-panel" ref={teamsPanelRef}>
            {!selectedGamemode ? (
              <p className="empty-state">Select a gamemode to see team structure</p>
            ) : (
              <div
                className={teamsContainerClassName}
                style={dynamicLayoutStyle}
                data-gamemode={normalizedGamemode || 'none'}
                data-layout-mode={isTeamDeathmatchMode ? (isTeamsPanelPortrait ? 'portrait' : 'landscape') : 'default'}
              >
                {modeConfig && Array.from({ length: modeConfig.teams }, (_, teamIndex) => (
                  <div key={teamIndex} className="team-block">
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
                        const unassignedParticipants = participants.filter(p => !Object.values(teamAssignments).flat().includes(p))
                        return (
                          <div
                            key={slotIndex}
                            className={`team-slot ${assignedPlayer ? 'filled' : 'empty'} ${lockedParticipants[assignedPlayer] === teamIndex ? 'locked' : ''}`}
                            onClick={() => {
                              if (isViewOnlyMode) return
                              // Only allow clicking to assign when slot is empty
                              if (!assignedPlayer && unassignedParticipants.length > 0) {
                                handleAssignToTeam(unassignedParticipants[0], teamIndex)
                              }
                            }}
                            title={
                              assignedPlayer
                                ? `${assignedPlayer}${lockedParticipants[assignedPlayer] === teamIndex ? ' (locked)' : ''}`
                                : isViewOnlyMode
                                  ? 'View mode'
                                  : unassignedParticipants.length > 0
                                    ? `Click to assign ${unassignedParticipants[0]}`
                                    : 'No available participants'
                            }
                          >
                            {assignedPlayer ? (
                              <div className="player-slot-content">
                                <div className="player-name-row">
                                  <span className="player-name">{assignedPlayer}</span>
                                  {!isViewOnlyMode && (
                                  <div className="player-actions">
                                    <button
                                      className={`player-randomize-btn ${lockedParticipants[assignedPlayer] === teamIndex ? 'disabled' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (lockedParticipants[assignedPlayer] !== teamIndex) {
                                          handleRandomizePlayerLoadout(assignedPlayer)
                                        }
                                      }}
                                      disabled={lockedParticipants[assignedPlayer] === teamIndex}
                                      title={lockedParticipants[assignedPlayer] === teamIndex ? 'Unlock player to randomize loadout' : 'Randomize this player\'s loadout'}
                                    >
                                      <DiceIcon />
                                    </button>
                                    <button
                                      className={`lock-all-loadout-btn ${(() => {
                                        const locks = lockedLoadouts[assignedPlayer] || {}
                                        const allLocked = locks.class === true && 
                                                          locks.specialization === true && 
                                                          locks.weapon === true && 
                                                          (locks.gadgets?.every(locked => locked === true) || false)
                                        return allLocked ? 'all-locked' : ''
                                      })()}`}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleToggleAllLoadoutLocks(assignedPlayer)
                                      }}
                                      title="Lock/unlock all loadout items"
                                    >
                                      <LockIcon />
                                    </button>
                                    <button
                                      className={`lock-btn ${lockedParticipants[assignedPlayer] === teamIndex ? 'locked' : ''}`}
                                      onClick={(e) => handleToggleLock(e, assignedPlayer, teamIndex)}
                                      title={lockedParticipants[assignedPlayer] === teamIndex ? 'Click to unlock' : 'Click to lock'}
                                    >
                                      {lockedParticipants[assignedPlayer] === teamIndex ? <LockIcon /> : <UnlockIcon />}
                                    </button>
                                    <button
                                      className="send-back-btn"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleSendBackToParticipants(assignedPlayer, teamIndex)
                                      }}
                                      disabled={lockedParticipants[assignedPlayer] === teamIndex}
                                      title={lockedParticipants[assignedPlayer] === teamIndex ? 'Unlock player to send back' : `Send ${assignedPlayer} back to participants`}
                                    >
                                      <MinusIcon />
                                    </button>
                                    <button
                                      className="remove-player-btn"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleRemoveFromTeamClick(assignedPlayer, teamIndex)
                                      }}
                                      disabled={lockedParticipants[assignedPlayer] === teamIndex}
                                      title={lockedParticipants[assignedPlayer] === teamIndex ? 'Unlock player to remove' : `Remove ${assignedPlayer} from team`}
                                    >
                                      <RemoveIcon />
                                    </button>
                                  </div>
                                  )}
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
                    {!isViewOnlyMode && participants.filter(p => !Object.values(teamAssignments).flat().includes(p)).length > 0 && (
                      <div className="assign-options">
                        <p>Assign:</p>
                        {participants
                          .filter(p => !Object.values(teamAssignments).flat().includes(p))
                          .map(name => (
                            <button
                              key={name}
                              className="assign-btn"
                              onClick={() => handleAssignToTeam(name, teamIndex)}
                              disabled={teamAssignments[teamIndex]?.length >= modeConfig.players_per_team}
                            >
                              {name}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>
          </section>
        </div>
      </main>

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
                <button className="modal-close-btn" onClick={() => setIsSettingsModalOpen(false)}>×</button>
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
                {participants.map((name) => {
                  const hasOverride = !!playerOverrides[name]
                  return (
                    <option
                      key={name}
                      value={name}
                      style={hasOverride ? undefined : { color: '#8b8b8b' }}
                    >
                      {hasOverride ? `${name}` : `${name} (not added)`}
                    </option>
                  )
                })}
              </select>
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
                            <img
                              src={specialization.imageFile}
                              alt={specialization.name}
                              className="spec-image"
                            />
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
                            <img
                              src={weapon.imageFile}
                              alt={weapon.name}
                              className="weapon-image"
                            />
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
                    {gadgets.map((gadget) => (
                      <div className={`weapon-settings-card ${getDisplayEnabledValue('gadgetEnabled', gadget.key) ? '' : 'disabled'}`} key={gadget.key}>
                        <div className="loadout-item-wrapper settings-weapon-wrapper">
                          <div
                            className={`loadout-item gadget-item settings-weapon-preview ${getDisplayEnabledValue('gadgetEnabled', gadget.key) ? '' : 'disabled'}`}
                            onClick={() => {
                              if (!settingsTargetIsReadOnly) {
                                updateSettingsMapValue('gadgetEnabled', gadget.key, !getDisplayEnabledValue('gadgetEnabled', gadget.key))
                              }
                            }}
                          >
                            <label className="weapon-enable-checkbox" title="Enable/disable this gadget in randomizer">
                              <input
                                type="checkbox"
                                checked={getDisplayEnabledValue('gadgetEnabled', gadget.key)}
                                onChange={(e) => updateSettingsMapValue('gadgetEnabled', gadget.key, e.target.checked)}
                                onClick={(e) => e.stopPropagation()}
                                disabled={settingsTargetIsReadOnly}
                              />
                            </label>
                            <img
                              src={gadget.imageFile}
                              alt={gadget.name}
                              className="gadget-image"
                            />
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
                            className={`settings-weight-percent ${getDisplayEnabledValue('gadgetEnabled', gadget.key) ? '' : 'is-zero'}`}
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
                    ))}
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
              <button className="modal-close-btn" onClick={() => setIsTeamSettingsModalOpen(false)}>×</button>
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
                    {participants.map((name) => (
                      <option key={`a-${name}`} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={keepSeparateB}
                    onChange={(e) => setKeepSeparateB(e.target.value)}
                    disabled={participants.length < 2}
                  >
                    {participants
                      .filter((name) => name !== keepSeparateA)
                      .map((name) => (
                        <option key={`b-${name}`} value={name}>
                          {name}
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
                        <span>{pair.playerA} vs {pair.playerB}</span>
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
              <button className="modal-close-btn" onClick={() => setLoadoutSelector(null)}>×</button>
            </div>
            <div className="modal-body loadout-selector-body">
              {loadoutSelector.type === 'class' && (
                <div className="selector-options">
                  {Object.keys(gameConfig.classes).map(className => {
                    const isExcluded = isItemExcluded(loadoutSelector.participant, 'class', null, className)
                    return (
                      <div key={className} className="selector-option-row">
                        <button
                          className="selector-option-btn"
                          onClick={() => handleLoadoutSelect(className)}
                        >
                          {className.charAt(0).toUpperCase() + className.slice(1)}
                        </button>
                        <label className="exclude-checkbox">
                          <input
                            type="checkbox"
                            checked={!isExcluded}
                            onChange={(e) => {
                              e.stopPropagation()
                              handleToggleExclude(loadoutSelector.participant, 'class', null, className)
                            }}
                          />
                          <span>Include</span>
                        </label>
                      </div>
                    )
                  })}
                </div>
              )}
              {loadoutSelector.type === 'specialization' && !loadouts[loadoutSelector.participant]?.class && (
                <div className="selector-options">
                  {Object.keys(gameConfig.classes).flatMap(className => 
                    gameConfig.classes[className].specializations?.map(spec => {
                      const isExcluded = isItemExcluded(loadoutSelector.participant, 'specialization', null, spec.name)
                      return (
                        <div key={`${className}-${spec.name}`} className="selector-option-row">
                          <button
                            className="selector-option-btn"
                            disabled
                            title="Select a class first to choose a specialization"
                          >
                            {spec.name} ({className})
                          </button>
                          <label className="exclude-checkbox">
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={(e) => {
                                e.stopPropagation()
                                handleToggleExclude(loadoutSelector.participant, 'specialization', null, spec.name)
                              }}
                            />
                            <span>Include</span>
                          </label>
                        </div>
                      )
                    }) || []
                  )}
                </div>
              )}
              {loadoutSelector.type === 'specialization' && loadouts[loadoutSelector.participant]?.class && (
                <div className="selector-options">
                  {gameConfig.classes[loadouts[loadoutSelector.participant].class]?.specializations?.map(spec => {
                    const isExcluded = isItemExcluded(loadoutSelector.participant, 'specialization', loadouts[loadoutSelector.participant].class, spec.name)
                    return (
                      <div key={spec.name} className="selector-option-row">
                        <button
                          className="selector-option-btn"
                          onClick={() => handleLoadoutSelect(spec)}
                        >
                          {spec.name}
                        </button>
                        <label className="exclude-checkbox">
                          <input
                            type="checkbox"
                            checked={!isExcluded}
                            onChange={(e) => {
                              e.stopPropagation()
                              handleToggleExclude(loadoutSelector.participant, 'specialization', loadouts[loadoutSelector.participant].class, spec.name)
                            }}
                          />
                          <span>Include</span>
                        </label>
                      </div>
                    )
                  })}
                </div>
              )}
              {loadoutSelector.type === 'weapon' && !loadouts[loadoutSelector.participant]?.class && (
                <div className="selector-options">
                  {Object.keys(gameConfig.classes).flatMap(className => 
                    gameConfig.classes[className].weapons?.map(weapon => {
                      const isExcluded = isItemExcluded(loadoutSelector.participant, 'weapon', null, weapon.name)
                      return (
                        <div key={`${className}-${weapon.name}`} className="selector-option-row">
                          <button
                            className="selector-option-btn"
                            disabled
                            title="Select a class first to choose a weapon"
                          >
                            {weapon.name} ({className})
                          </button>
                          <label className="exclude-checkbox">
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={(e) => {
                                e.stopPropagation()
                                handleToggleExclude(loadoutSelector.participant, 'weapon', null, weapon.name)
                              }}
                            />
                            <span>Include</span>
                          </label>
                        </div>
                      )
                    }) || []
                  )}
                </div>
              )}
              {loadoutSelector.type === 'weapon' && loadouts[loadoutSelector.participant]?.class && (
                <div className="selector-options">
                  {gameConfig.classes[loadouts[loadoutSelector.participant].class]?.weapons?.map(weapon => {
                    const isExcluded = isItemExcluded(loadoutSelector.participant, 'weapon', loadouts[loadoutSelector.participant].class, weapon.name)
                    return (
                      <div key={weapon.name} className="selector-option-row">
                        <button
                          className="selector-option-btn"
                          onClick={() => handleLoadoutSelect(weapon)}
                        >
                          {weapon.name}
                        </button>
                        <label className="exclude-checkbox">
                          <input
                            type="checkbox"
                            checked={!isExcluded}
                            onChange={(e) => {
                              e.stopPropagation()
                              handleToggleExclude(loadoutSelector.participant, 'weapon', loadouts[loadoutSelector.participant].class, weapon.name)
                            }}
                          />
                          <span>Include</span>
                        </label>
                      </div>
                    )
                  })}
                </div>
              )}
              {loadoutSelector.type === 'gadget' && !loadouts[loadoutSelector.participant]?.class && (
                <div className="selector-options">
                  {Object.keys(gameConfig.classes).flatMap(className => 
                    gameConfig.classes[className].gadgets?.map(gadget => {
                      const isExcluded = isItemExcluded(loadoutSelector.participant, 'gadget', null, gadget.name)
                      return (
                        <div key={`${className}-${gadget.name}`} className="selector-option-row">
                          <button
                            className="selector-option-btn"
                            disabled
                            title="Select a class first to choose a gadget"
                          >
                            {gadget.name} ({className})
                          </button>
                          <label className="exclude-checkbox">
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={(e) => {
                                e.stopPropagation()
                                handleToggleExclude(loadoutSelector.participant, 'gadget', null, gadget.name)
                              }}
                            />
                            <span>Include</span>
                          </label>
                        </div>
                      )
                    }) || []
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
                    ?.map(gadget => {
                      const isExcluded = isItemExcluded(loadoutSelector.participant, 'gadget', loadouts[loadoutSelector.participant].class, gadget.name)
                      return (
                        <div key={gadget.name} className="selector-option-row">
                          <button
                            className="selector-option-btn"
                            onClick={() => handleLoadoutSelect(gadget)}
                          >
                            {gadget.name}
                          </button>
                          <label className="exclude-checkbox">
                            <input
                              type="checkbox"
                              checked={!isExcluded}
                              onChange={(e) => {
                                e.stopPropagation()
                                handleToggleExclude(loadoutSelector.participant, 'gadget', loadouts[loadoutSelector.participant].class, gadget.name)
                              }}
                            />
                            <span>Include</span>
                          </label>
                        </div>
                      )
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Remove Player Confirmation Modal */}
      {removeConfirmation && (
        <div className="modal-overlay" onClick={() => setRemoveConfirmation(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Remove Player</h2>
              <button className="modal-close-btn" onClick={() => setRemoveConfirmation(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to remove <strong>{removeConfirmation.participant}</strong> from team {removeConfirmation.teamIndex + 1}?</p>
              <p style={{ color: '#aaa', fontSize: '0.9em', marginTop: '1rem' }}>This will permanently remove the player from the game and cannot be undone.</p>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
                <button 
                  className="randomize-btn" 
                  onClick={() => setRemoveConfirmation(null)}
                  style={{ background: '#555' }}
                >
                  Cancel
                </button>
                <button 
                  className="randomize-btn clear-btn" 
                  onClick={handleConfirmRemove}
                >
                  Remove Player
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
