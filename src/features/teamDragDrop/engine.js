export const TEAM_DRAG_MIME = 'application/x-finals-team-drag'

export function firstEmptySlotIndex(teamArr, maxSlots) {
  const a = teamArr || []
  for (let i = 0; i < maxSlots; i += 1) {
    if (!a[i]) return i
  }
  return -1
}

export function canPlaceParticipantOnTeam(lockedParticipants, participant, teamIndex) {
  const t = lockedParticipants[participant]
  return t === undefined || t === teamIndex
}

export function removeParticipantFromAssignments(assignments, participant) {
  const next = { ...assignments }
  for (const ti of Object.keys(next)) {
    const t = Number(ti)
    next[t] = (next[t] || []).filter((p) => p !== participant)
  }
  return next
}

export function poolToOccupiedSlot(assignments, pDrag, targetTeam, targetSlot, lockedParticipants) {
  const occ = assignments[targetTeam]?.[targetSlot]
  if (!occ) return null
  if (lockedParticipants[occ] === targetTeam) return null
  if (!canPlaceParticipantOnTeam(lockedParticipants, pDrag, targetTeam)) return null

  const next = removeParticipantFromAssignments(assignments, pDrag)
  const arr = [...(next[targetTeam] || [])]
  if (arr[targetSlot] !== occ) return null
  arr[targetSlot] = pDrag
  next[targetTeam] = arr.filter((x) => x != null)
  return next
}

export function poolOrTeamToFirstEmpty(assignments, pDrag, targetTeam, maxPerTeam, lockedParticipants) {
  if (!canPlaceParticipantOnTeam(lockedParticipants, pDrag, targetTeam)) return null
  const next = removeParticipantFromAssignments(assignments, pDrag)
  const arr = [...(next[targetTeam] || [])]
  const fi = firstEmptySlotIndex(arr, maxPerTeam)
  if (fi < 0) return null
  while (arr.length < fi) {
    arr.push(undefined)
  }
  if (fi < arr.length && !arr[fi]) {
    arr[fi] = pDrag
  } else if (fi === arr.length) {
    arr.push(pDrag)
  } else {
    return null
  }
  next[targetTeam] = arr.filter((x) => x != null)
  return next
}

export function teamSwapSlots(assignments, fromT, fromS, toT, toS, lockedParticipants) {
  const pFrom = assignments[fromT]?.[fromS]
  const pTo = assignments[toT]?.[toS]
  if (!pFrom || !pTo || pFrom === pTo) return null
  if (lockedParticipants[pFrom] === fromT) return null
  if (lockedParticipants[pTo] === toT) return null
  if (!canPlaceParticipantOnTeam(lockedParticipants, pFrom, toT)) return null
  if (!canPlaceParticipantOnTeam(lockedParticipants, pTo, fromT)) return null

  const next = { ...assignments }
  if (fromT === toT) {
    const a = [...(next[fromT] || [])]
    if (a[fromS] !== pFrom || a[toS] !== pTo) return null
    ;[a[fromS], a[toS]] = [a[toS], a[fromS]]
    next[fromT] = a
    return next
  }
  const a1 = [...(next[fromT] || [])]
  const a2 = [...(next[toT] || [])]
  if (a1[fromS] !== pFrom || a2[toS] !== pTo) return null
  a1[fromS] = pTo
  a2[toS] = pFrom
  next[fromT] = a1
  next[toT] = a2
  return next
}

export function applyTeamDragDrop({
  assignments,
  lockedParticipants,
  participant: pDrag,
  fromTeam,
  fromSlot,
  targetTeamIndex,
  targetSlotIndex,
  targetOccupant,
  maxPerTeam
}) {
  if (fromTeam != null && lockedParticipants[pDrag] === fromTeam) return null
  if (fromTeam === targetTeamIndex && fromSlot === targetSlotIndex) return null

  if (targetOccupant) {
    if (lockedParticipants[targetOccupant] === targetTeamIndex) return null
    if (fromTeam == null) {
      return poolToOccupiedSlot(
        assignments,
        pDrag,
        targetTeamIndex,
        targetSlotIndex,
        lockedParticipants
      )
    }
    return teamSwapSlots(
      assignments,
      fromTeam,
      fromSlot,
      targetTeamIndex,
      targetSlotIndex,
      lockedParticipants
    )
  }

  if (fromTeam != null && fromTeam === targetTeamIndex) return null

  return poolOrTeamToFirstEmpty(
    assignments,
    pDrag,
    targetTeamIndex,
    maxPerTeam,
    lockedParticipants
  )
}

/** Mirrors applyTeamDragDrop for hover preview only (no mutation). */
export function previewTeamDragDrop({
  assignments,
  lockedParticipants,
  participant: pDrag,
  fromTeam,
  fromSlot,
  targetTeamIndex,
  targetSlotIndex,
  targetOccupant,
  maxPerTeam
}) {
  if (fromTeam != null && lockedParticipants[pDrag] === fromTeam) return 'invalid'
  if (fromTeam === targetTeamIndex && fromSlot === targetSlotIndex) return 'invalid'

  if (targetOccupant) {
    if (lockedParticipants[targetOccupant] === targetTeamIndex) return 'invalid'
    if (fromTeam == null) {
      return poolToOccupiedSlot(
        assignments,
        pDrag,
        targetTeamIndex,
        targetSlotIndex,
        lockedParticipants
      )
        ? 'replace'
        : 'invalid'
    }
    return teamSwapSlots(
      assignments,
      fromTeam,
      fromSlot,
      targetTeamIndex,
      targetSlotIndex,
      lockedParticipants
    )
      ? 'swap'
      : 'invalid'
  }

  if (fromTeam != null && fromTeam === targetTeamIndex) return 'invalid'

  return poolOrTeamToFirstEmpty(
    assignments,
    pDrag,
    targetTeamIndex,
    maxPerTeam,
    lockedParticipants
  )
    ? 'place'
    : 'invalid'
}

export function setTeamDragTransferData(dataTransfer, { participant, fromTeam, fromSlot }) {
  const payload = JSON.stringify({ participant, fromTeam, fromSlot })
  dataTransfer.setData(TEAM_DRAG_MIME, payload)
  dataTransfer.setData('text/plain', payload)
  dataTransfer.effectAllowed = 'move'
}

export function parseTeamDragTransfer(dataTransfer) {
  try {
    const rawJson = dataTransfer.getData(TEAM_DRAG_MIME) || dataTransfer.getData('text/plain')
    if (!rawJson) return null
    const raw = JSON.parse(rawJson)
    if (!raw || typeof raw.participant !== 'string') return null
    return {
      participant: raw.participant,
      fromTeam: raw.fromTeam == null ? null : Number(raw.fromTeam),
      fromSlot: raw.fromSlot == null ? null : Number(raw.fromSlot)
    }
  } catch {
    return null
  }
}
