import { describe, expect, it } from 'vitest'
import {
  applyTeamDragDrop,
  firstEmptySlotIndex,
  parseTeamDragTransfer,
  previewTeamDragDrop,
  removeParticipantFromAssignments,
  setTeamDragTransferData
} from '../engine'

const lockedParticipants = {}

describe('team drag/drop decision engine', () => {
  it('returns first empty slot index', () => {
    expect(firstEmptySlotIndex(['a', undefined, 'b'], 3)).toBe(1)
    expect(firstEmptySlotIndex(['a', 'b', 'c'], 3)).toBe(-1)
  })

  it('removes participant from every team', () => {
    const assignments = { 0: ['a', 'b'], 1: ['a', 'c'] }
    expect(removeParticipantFromAssignments(assignments, 'a')).toEqual({
      0: ['b'],
      1: ['c']
    })
  })

  it('allows same-team swap on occupied target', () => {
    const assignments = { 0: ['a', 'b'], 1: [] }
    const next = applyTeamDragDrop({
      assignments,
      lockedParticipants,
      participant: 'a',
      fromTeam: 0,
      fromSlot: 0,
      targetTeamIndex: 0,
      targetSlotIndex: 1,
      targetOccupant: 'b',
      maxPerTeam: 2
    })
    expect(next).toEqual({ 0: ['b', 'a'], 1: [] })
  })

  it('rejects same-team place on empty target', () => {
    const assignments = { 0: ['a'], 1: [] }
    const next = applyTeamDragDrop({
      assignments,
      lockedParticipants,
      participant: 'a',
      fromTeam: 0,
      fromSlot: 0,
      targetTeamIndex: 0,
      targetSlotIndex: 1,
      targetOccupant: null,
      maxPerTeam: 3
    })
    expect(next).toBeNull()
  })

  it('allows pool replace on occupied slot', () => {
    const assignments = { 0: ['a', 'b'], 1: [] }
    const next = applyTeamDragDrop({
      assignments,
      lockedParticipants,
      participant: 'poolP',
      fromTeam: null,
      fromSlot: null,
      targetTeamIndex: 0,
      targetSlotIndex: 1,
      targetOccupant: 'b',
      maxPerTeam: 2
    })
    expect(next).toEqual({ 0: ['a', 'poolP'], 1: [] })
  })

  it('places on first empty for cross-team empty target', () => {
    const assignments = { 0: ['a'], 1: ['x'] }
    const next = applyTeamDragDrop({
      assignments,
      lockedParticipants,
      participant: 'a',
      fromTeam: 0,
      fromSlot: 0,
      targetTeamIndex: 1,
      targetSlotIndex: 2,
      targetOccupant: null,
      maxPerTeam: 3
    })
    expect(next).toEqual({ 0: [], 1: ['x', 'a'] })
  })

  it('rejects place when target team is full', () => {
    const assignments = { 0: ['a'], 1: ['x', 'y'] }
    const next = applyTeamDragDrop({
      assignments,
      lockedParticipants,
      participant: 'a',
      fromTeam: 0,
      fromSlot: 0,
      targetTeamIndex: 1,
      targetSlotIndex: 0,
      targetOccupant: null,
      maxPerTeam: 2
    })
    expect(next).toBeNull()
  })

  it('preview mirrors invalid/replace/swap/place outcomes', () => {
    const assignments = { 0: ['a', 'b'], 1: ['x'] }
    expect(
      previewTeamDragDrop({
        assignments,
        lockedParticipants,
        participant: 'a',
        fromTeam: 0,
        fromSlot: 0,
        targetTeamIndex: 0,
        targetSlotIndex: 1,
        targetOccupant: 'b',
        maxPerTeam: 2
      })
    ).toBe('swap')
    expect(
      previewTeamDragDrop({
        assignments,
        lockedParticipants,
        participant: 'poolP',
        fromTeam: null,
        fromSlot: null,
        targetTeamIndex: 0,
        targetSlotIndex: 1,
        targetOccupant: 'b',
        maxPerTeam: 2
      })
    ).toBe('replace')
    expect(
      previewTeamDragDrop({
        assignments,
        lockedParticipants,
        participant: 'a',
        fromTeam: 0,
        fromSlot: 0,
        targetTeamIndex: 0,
        targetSlotIndex: 1,
        targetOccupant: null,
        maxPerTeam: 3
      })
    ).toBe('invalid')
    expect(
      previewTeamDragDrop({
        assignments,
        lockedParticipants,
        participant: 'a',
        fromTeam: 0,
        fromSlot: 0,
        targetTeamIndex: 1,
        targetSlotIndex: 0,
        targetOccupant: null,
        maxPerTeam: 2
      })
    ).toBe('place')
  })

  it('serializes and parses drag transfer payload', () => {
    const store = new Map()
    const dt = {
      effectAllowed: 'none',
      setData(type, value) {
        store.set(type, value)
      },
      getData(type) {
        return store.get(type) || ''
      }
    }
    setTeamDragTransferData(dt, { participant: 'abc', fromTeam: 1, fromSlot: 2 })
    expect(dt.effectAllowed).toBe('move')
    expect(parseTeamDragTransfer(dt)).toEqual({
      participant: 'abc',
      fromTeam: 1,
      fromSlot: 2
    })
  })
})
