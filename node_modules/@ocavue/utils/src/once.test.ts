// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { once } from './once'

describe('once', () => {
  it('executes the wrapped function exactly once', () => {
    const spy = vi.fn(() => Math.random())
    const getRandom = once(spy)

    const first = getRandom()
    const second = getRandom()
    const third = getRandom()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  it("returns the underlying function's result", () => {
    const value = { foo: 'bar' }
    const getValue = once(() => value)
    expect(getValue()).toBe(value)
  })
})
