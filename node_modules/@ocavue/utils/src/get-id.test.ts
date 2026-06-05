import { describe, it, expect } from 'vitest'

import { getId, setMaxSafeInteger } from './get-id'

describe('getId', () => {
  it('returns a positive number', () => {
    const id = getId()
    expect(id).toBeGreaterThan(0)
  })

  it('returns different values on consecutive calls', () => {
    expect(getId()).not.toBe(getId())
  })

  it('never exceeds the configured maximum', () => {
    const max = 5
    setMaxSafeInteger(max)
    let prevId = -1

    try {
      for (let i = 0; i < max * 3; i += 1) {
        const id = getId()
        expect(id).toBeLessThan(max)
        expect(id).toBeGreaterThanOrEqual(1)
        expect(id).not.toBe(prevId)

        prevId = id
      }
    } finally {
      setMaxSafeInteger(Number.MAX_SAFE_INTEGER)
    }
  })
})
