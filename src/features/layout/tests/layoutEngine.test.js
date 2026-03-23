import { describe, expect, it } from 'vitest'
import { computeDynamicLayout } from '../layoutEngine'

const BASE_INPUT = {
  panelWidth: 1800,
  panelHeight: 900,
  viewportWidth: 1600,
  teams: 2,
  playersPerTeam: 5,
  hasAssignOptions: true,
  assignOptionsCount: 3
}

const expectSensibleLayout = (layout, input) => {
  expect(layout).toBeTruthy()
  expect(layout.itemSize).toBeGreaterThan(12)
  expect(layout.teamGrid.rows * layout.teamGrid.cols).toBeGreaterThanOrEqual(input.teams)
  expect(layout.playerGrid.rows * layout.playerGrid.cols).toBeGreaterThanOrEqual(input.playersPerTeam)
  expect(layout.loadoutGrid.rows * layout.loadoutGrid.cols).toBeGreaterThanOrEqual(6)
  expect(layout.slotRequiredWidth).toBeGreaterThan(0)
  expect(layout.slotRequiredHeight).toBeGreaterThan(0)
  expect(layout.playerGridWidth).toBeGreaterThan(0)
  expect(layout.playerGridHeight).toBeGreaterThan(0)
  expect(layout.teamBlockWidth).toBeGreaterThan(0)
  expect(layout.teamBlockHeight).toBeGreaterThan(0)
}

describe('computeDynamicLayout', () => {
  it('returns null when required panel dimensions are missing', () => {
    expect(
      computeDynamicLayout({
        ...BASE_INPUT,
        panelWidth: 0
      })
    ).toBeNull()
    expect(
      computeDynamicLayout({
        ...BASE_INPUT,
        panelHeight: 0
      })
    ).toBeNull()
  })

  it('computes a sensible desktop layout for dynamic mode', () => {
    const layout = computeDynamicLayout(BASE_INPUT)
    expectSensibleLayout(layout, BASE_INPUT)
  })

  it('forces mobile-friendly grids on narrow viewport', () => {
    const input = {
      ...BASE_INPUT,
      viewportWidth: 700,
      teams: 3,
      playersPerTeam: 8
    }
    const layout = computeDynamicLayout(input)
    expectSensibleLayout(layout, input)
    expect(layout.teamGrid.cols).toBe(1)
    expect(layout.loadoutGrid).toEqual({ rows: 2, cols: 3 })
  })

  it('uses measured reserve values when provided', () => {
    const baseline = computeDynamicLayout({
      ...BASE_INPUT,
      assignOptionsReserve: undefined
    })
    const measured = computeDynamicLayout({
      ...BASE_INPUT,
      assignOptionsReserve: 180
    })
    expect(baseline).toBeTruthy()
    expect(measured).toBeTruthy()
    expect(measured.teamBlockHeight).toBeGreaterThanOrEqual(baseline.teamBlockHeight)
  })
})
