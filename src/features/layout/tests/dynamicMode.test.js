import { describe, expect, it } from 'vitest'
import { isDynamicLayoutModeConfig, isDynamicLayoutPlayersPerTeam } from '../dynamicMode'

describe('dynamic mode rules', () => {
  it('enables dynamic mode for 3/5/8 players per team', () => {
    expect(isDynamicLayoutPlayersPerTeam(3)).toBe(true)
    expect(isDynamicLayoutPlayersPerTeam(5)).toBe(true)
    expect(isDynamicLayoutPlayersPerTeam(8)).toBe(true)
  })

  it('disables dynamic mode for non-supported team sizes', () => {
    expect(isDynamicLayoutPlayersPerTeam(1)).toBe(false)
    expect(isDynamicLayoutPlayersPerTeam(2)).toBe(false)
    expect(isDynamicLayoutPlayersPerTeam(4)).toBe(false)
    expect(isDynamicLayoutPlayersPerTeam(6)).toBe(false)
    expect(isDynamicLayoutPlayersPerTeam(undefined)).toBe(false)
  })

  it('evaluates mode config safely', () => {
    expect(isDynamicLayoutModeConfig({ players_per_team: 5 })).toBe(true)
    expect(isDynamicLayoutModeConfig({ players_per_team: 2 })).toBe(false)
    expect(isDynamicLayoutModeConfig(null)).toBe(false)
    expect(isDynamicLayoutModeConfig(undefined)).toBe(false)
  })
})
