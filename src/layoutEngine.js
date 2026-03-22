const LAYOUT_REM_IN_PX = 16
const MOBILE_LAYOUT_BREAKPOINT_PX = 800

const DYNAMIC_LAYOUT_METRICS = {
  panelPaddingX: 3 * LAYOUT_REM_IN_PX,
  panelPaddingY: 3 * LAYOUT_REM_IN_PX,
  teamGap: 1.5 * LAYOUT_REM_IN_PX,
  slotGap: 0.5 * LAYOUT_REM_IN_PX,
  loadoutGap: 0.5 * LAYOUT_REM_IN_PX,
  teamPaddingX: 2 * LAYOUT_REM_IN_PX,
  teamPaddingY: 2 * LAYOUT_REM_IN_PX,
  teamBorder: 4,
  teamHeaderReserve: 3.5 * LAYOUT_REM_IN_PX,
  teamHeaderReserveCompact: 24 + 0.8 * LAYOUT_REM_IN_PX,
  slotPaddingX: 1.5 * LAYOUT_REM_IN_PX,
  slotPaddingY: 1.5 * LAYOUT_REM_IN_PX,
  slotBorder: 4,
  playerNameRowHeight: 38,
  slotContentGap: 0.5 * LAYOUT_REM_IN_PX,
  loadoutVerticalSafety: 0.5 * LAYOUT_REM_IN_PX,
  labelHeight: 30,
  assignOptionsLabelHeight: 1.5 * LAYOUT_REM_IN_PX,
  assignButtonMinWidth: 6.5 * LAYOUT_REM_IN_PX,
  assignButtonRowHeight: 2.2 * LAYOUT_REM_IN_PX,
  assignButtonGap: 0.4 * LAYOUT_REM_IN_PX,
  assignOptionsBottomPadding: 0.5 * LAYOUT_REM_IN_PX
}

const LOADOUT_GRID_CANDIDATES = [
  { rows: 1, cols: 6 },
  { rows: 2, cols: 3 },
  { rows: 3, cols: 2 }
]

const getTeamGridCandidates = (teams) => {
  if (teams === 2) return [{ rows: 1, cols: 2 }, { rows: 2, cols: 1 }]
  if (teams === 3) return [{ rows: 1, cols: 3 }, { rows: 3, cols: 1 }, { rows: 2, cols: 2 }]
  if (teams === 4) return [{ rows: 2, cols: 2 }, { rows: 1, cols: 4 }, { rows: 4, cols: 1 }]
  return [{ rows: 1, cols: Math.max(1, teams) }]
}

const getPlayerGridCandidates = (playersPerTeam) => {
  if (playersPerTeam === 3) return [{ rows: 1, cols: 3 }, { rows: 3, cols: 1 }]
  if (playersPerTeam === 5) return [{ rows: 1, cols: 5 }, { rows: 5, cols: 1 }]
  if (playersPerTeam === 8) return [{ rows: 2, cols: 4 }, { rows: 4, cols: 2 }, { rows: 1, cols: 8 }, { rows: 8, cols: 1 }]
  return [{ rows: 1, cols: Math.max(1, playersPerTeam) }]
}

const estimateAssignOptionsReserve = ({ teamInnerWidth, hasAssignOptions, assignOptionsCount }) => {
  if (!hasAssignOptions || assignOptionsCount <= 0) return 0
  const buttonsPerRow = Math.max(
    1,
    Math.floor(
      (teamInnerWidth + DYNAMIC_LAYOUT_METRICS.assignButtonGap) /
        (DYNAMIC_LAYOUT_METRICS.assignButtonMinWidth + DYNAMIC_LAYOUT_METRICS.assignButtonGap)
    )
  )
  const buttonRows = Math.max(1, Math.ceil(assignOptionsCount / buttonsPerRow))
  return (
    DYNAMIC_LAYOUT_METRICS.assignOptionsLabelHeight +
    buttonRows * DYNAMIC_LAYOUT_METRICS.assignButtonRowHeight +
    DYNAMIC_LAYOUT_METRICS.assignOptionsBottomPadding
  )
}

export const computeDynamicLayout = ({
  panelWidth,
  viewportWidth,
  panelHeight,
  teams,
  playersPerTeam,
  hasAssignOptions = false,
  assignOptionsCount = 0,
  teamHeaderReserve,
  playerNameRowHeight,
  assignOptionsReserve
}) => {
  if (!panelWidth || !panelHeight || !teams || !playersPerTeam) return null
  const isMobileLayout = Number.isFinite(viewportWidth) && viewportWidth <= MOBILE_LAYOUT_BREAKPOINT_PX
  const isCompactLayout = Number.isFinite(viewportWidth) && viewportWidth <= 1268
  const loadoutGridCandidates = isMobileLayout ? [{ rows: 2, cols: 3 }] : LOADOUT_GRID_CANDIDATES
  const effectiveLabelHeight = DYNAMIC_LAYOUT_METRICS.labelHeight
  const effectiveTeamHeaderReserve =
    Number.isFinite(teamHeaderReserve) && teamHeaderReserve > 0
      ? teamHeaderReserve
      : isCompactLayout
        ? DYNAMIC_LAYOUT_METRICS.teamHeaderReserveCompact
        : DYNAMIC_LAYOUT_METRICS.teamHeaderReserve
  const effectivePlayerNameRowHeight =
    Number.isFinite(playerNameRowHeight) && playerNameRowHeight > 0
      ? playerNameRowHeight
      : DYNAMIC_LAYOUT_METRICS.playerNameRowHeight
  const measuredAssignOptionsReserve =
    Number.isFinite(assignOptionsReserve) && assignOptionsReserve >= 0
      ? assignOptionsReserve
      : null
  const effectiveSlotPaddingX = isCompactLayout
    ? DYNAMIC_LAYOUT_METRICS.slotPaddingX / 2
    : DYNAMIC_LAYOUT_METRICS.slotPaddingX
  const effectiveSlotPaddingY = isCompactLayout
    ? DYNAMIC_LAYOUT_METRICS.slotPaddingY / 2
    : DYNAMIC_LAYOUT_METRICS.slotPaddingY
  const effectiveSlotContentGap = isCompactLayout ? 0 : DYNAMIC_LAYOUT_METRICS.slotContentGap

  const availablePanelWidth = panelWidth - DYNAMIC_LAYOUT_METRICS.panelPaddingX
  const availablePanelHeight = panelHeight - DYNAMIC_LAYOUT_METRICS.panelPaddingY
  if (availablePanelWidth <= 0 || availablePanelHeight <= 0) return null

  const teamCandidates = (
    isMobileLayout ? [{ rows: Math.max(1, teams), cols: 1 }] : getTeamGridCandidates(teams)
  ).filter(({ rows, cols }) => rows * cols >= teams)
  const playerCandidates = getPlayerGridCandidates(playersPerTeam).filter(({ rows, cols }) => rows * cols >= playersPerTeam)
  let best = null

  for (const teamGrid of teamCandidates) {
    const teamWidth =
      (availablePanelWidth - (teamGrid.cols - 1) * DYNAMIC_LAYOUT_METRICS.teamGap) / teamGrid.cols
    const teamHeight =
      (availablePanelHeight - (teamGrid.rows - 1) * DYNAMIC_LAYOUT_METRICS.teamGap) / teamGrid.rows
    if (teamWidth <= 0 || teamHeight <= 0) continue

    const teamInnerWidth =
      teamWidth - DYNAMIC_LAYOUT_METRICS.teamPaddingX - DYNAMIC_LAYOUT_METRICS.teamBorder
    const teamInnerHeightBase =
      teamHeight -
      DYNAMIC_LAYOUT_METRICS.teamPaddingY -
      effectiveTeamHeaderReserve -
      DYNAMIC_LAYOUT_METRICS.teamBorder
    const estimatedAssignOptionsReserve = estimateAssignOptionsReserve({
      teamInnerWidth,
      hasAssignOptions,
      assignOptionsCount
    })
    const effectiveAssignOptionsReserve =
      measuredAssignOptionsReserve !== null ? measuredAssignOptionsReserve : estimatedAssignOptionsReserve
    const teamInnerHeight = teamInnerHeightBase - effectiveAssignOptionsReserve
    if (teamInnerWidth <= 0 || teamInnerHeight <= 0) continue

    for (const playerGrid of playerCandidates) {
      const slotWidth =
        (teamInnerWidth - (playerGrid.cols - 1) * DYNAMIC_LAYOUT_METRICS.slotGap) / playerGrid.cols
      const slotHeight =
        (teamInnerHeight - (playerGrid.rows - 1) * DYNAMIC_LAYOUT_METRICS.slotGap) / playerGrid.rows
      const slotContentWidth =
        slotWidth - effectiveSlotPaddingX - DYNAMIC_LAYOUT_METRICS.slotBorder
      const slotContentHeight =
        slotHeight - effectiveSlotPaddingY - DYNAMIC_LAYOUT_METRICS.slotBorder
      const slotLoadoutWidth = slotContentWidth
      const slotLoadoutHeight =
        slotContentHeight -
        effectivePlayerNameRowHeight -
        effectiveSlotContentGap -
        DYNAMIC_LAYOUT_METRICS.loadoutVerticalSafety
      if (slotLoadoutWidth <= 0 || slotLoadoutHeight <= 0) continue

      for (const loadoutGrid of loadoutGridCandidates) {
        const widthLimited =
          (slotLoadoutWidth - (loadoutGrid.cols - 1) * DYNAMIC_LAYOUT_METRICS.loadoutGap) /
          loadoutGrid.cols
        const heightLimited =
          (slotLoadoutHeight -
            (loadoutGrid.rows - 1) * DYNAMIC_LAYOUT_METRICS.loadoutGap -
            loadoutGrid.rows * effectiveLabelHeight) /
          loadoutGrid.rows

        const itemSize = Math.floor(
          isMobileLayout
            ? widthLimited
            : Math.min(widthLimited, heightLimited)
        )
        if (itemSize <= 12) continue

        const usedLoadoutWidth =
          loadoutGrid.cols * itemSize + (loadoutGrid.cols - 1) * DYNAMIC_LAYOUT_METRICS.loadoutGap
        const usedLoadoutHeight =
          loadoutGrid.rows * itemSize +
          (loadoutGrid.rows - 1) * DYNAMIC_LAYOUT_METRICS.loadoutGap +
          loadoutGrid.rows * effectiveLabelHeight

        const slackW = Math.max(0, slotLoadoutWidth - usedLoadoutWidth)
        const slackH = Math.max(0, slotLoadoutHeight - usedLoadoutHeight)
        const unusedRatio = (slackW + slackH) / Math.max(1, slotLoadoutWidth + slotLoadoutHeight)
        const score = itemSize - unusedRatio * 32

        if (!best || score > best.score) {
          const slotRequiredWidth =
            usedLoadoutWidth + effectiveSlotPaddingX + DYNAMIC_LAYOUT_METRICS.slotBorder
          const slotRequiredHeight =
            usedLoadoutHeight +
            effectivePlayerNameRowHeight +
            effectiveSlotContentGap +
            DYNAMIC_LAYOUT_METRICS.loadoutVerticalSafety +
            effectiveSlotPaddingY +
            DYNAMIC_LAYOUT_METRICS.slotBorder
          const playerGridWidth =
            playerGrid.cols * slotRequiredWidth +
            (playerGrid.cols - 1) * DYNAMIC_LAYOUT_METRICS.slotGap
          const playerGridHeight =
            playerGrid.rows * slotRequiredHeight +
            (playerGrid.rows - 1) * DYNAMIC_LAYOUT_METRICS.slotGap
          const teamBlockWidth =
            playerGridWidth + DYNAMIC_LAYOUT_METRICS.teamPaddingX + DYNAMIC_LAYOUT_METRICS.teamBorder
          const teamBlockHeight =
            playerGridHeight +
            DYNAMIC_LAYOUT_METRICS.teamPaddingY +
            effectiveTeamHeaderReserve +
            DYNAMIC_LAYOUT_METRICS.teamBorder +
            effectiveAssignOptionsReserve
          best = {
            score,
            itemSize,
            teamGrid,
            playerGrid,
            loadoutGrid,
            labelHeight: effectiveLabelHeight,
            slotRequiredWidth,
            slotRequiredHeight,
            playerGridWidth,
            playerGridHeight,
            teamBlockWidth,
            teamBlockHeight
          }
        }
      }
    }
  }

  return best
}
