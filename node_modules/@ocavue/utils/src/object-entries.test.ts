// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { objectEntries } from './object-entries'

describe('objectEntries', () => {
  it('returns entries for an empty object', () => {
    const obj = {}
    const entries = objectEntries(obj)
    expect(entries).toEqual([])
  })

  it('returns entries for objects with mixed types', () => {
    const obj = { name: 'Alice', age: 30, active: true }
    const entries = objectEntries(obj)
    expect(entries).toEqual([
      ['name', 'Alice'],
      ['age', 30],
      ['active', true],
    ])
  })

  it('preserves type safety with const objects', () => {
    const obj = { a: 1, b: 'hello', c: true } as const
    const entries = objectEntries(obj)

    expect(entries).toHaveLength(3)
    expect(entries).toContainEqual(['a', 1])
    expect(entries).toContainEqual(['b', 'hello'])
    expect(entries).toContainEqual(['c', true])
  })
})
