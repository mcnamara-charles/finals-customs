const DYNAMIC_LAYOUT_PLAYERS_PER_TEAM = new Set([3, 5, 8])

export const isDynamicLayoutModeConfig = (modeConfig) => {
  if (!modeConfig) return false
  return DYNAMIC_LAYOUT_PLAYERS_PER_TEAM.has(modeConfig.players_per_team)
}

export const isDynamicLayoutPlayersPerTeam = (playersPerTeam) =>
  DYNAMIC_LAYOUT_PLAYERS_PER_TEAM.has(playersPerTeam)
