// @vitest-environment node

import { describe, it, expect, vi } from 'vitest'

import { sleep } from './sleep'

describe('sleep', () => {
  it('resolves after the specified time', async () => {
    vi.useFakeTimers()

    const promise = sleep(1000)

    // Advance time by 999ms - promise should not resolve yet
    vi.advanceTimersByTime(999)
    await Promise.resolve() // flush microtasks

    let resolved = false
    void promise.then(() => {
      resolved = true
    })
    await Promise.resolve() // flush microtasks
    expect(resolved).toBe(false)

    // Advance time by 1ms more (total 1000ms) - promise should now resolve
    vi.advanceTimersByTime(1)
    await promise

    expect(resolved).toBe(true)

    vi.useRealTimers()
  })

  it('returns a promise that resolves to undefined', async () => {
    vi.useFakeTimers()

    const promise = sleep(100)
    vi.advanceTimersByTime(100)

    const result = await promise
    expect(result).toBe(undefined)

    vi.useRealTimers()
  })
})
