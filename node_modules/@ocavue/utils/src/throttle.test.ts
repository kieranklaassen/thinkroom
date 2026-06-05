// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { throttle } from './throttle'

describe('throttle', () => {
  it('calls the function immediately on first invocation', () => {
    vi.useFakeTimers()

    const spy = vi.fn()
    const throttled = throttle(spy, 100)

    throttled()
    expect(spy).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('passes arguments correctly', () => {
    vi.useFakeTimers()

    const spy = vi.fn()
    const throttled = throttle(spy, 100)

    throttled('a', 'b')
    expect(spy).toHaveBeenCalledWith('a', 'b')

    vi.useRealTimers()
  })

  it('ignores calls during the wait period', () => {
    vi.useFakeTimers()

    const spy = vi.fn()
    const throttled = throttle(spy, 100)

    throttled()
    throttled()
    throttled()

    expect(spy).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('executes trailing call with latest args after wait period', () => {
    vi.useFakeTimers()

    const spy = vi.fn()
    const throttled = throttle(spy, 100)

    throttled('first')
    throttled('second')
    throttled('third')

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('first')

    vi.advanceTimersByTime(100)

    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenLastCalledWith('third')

    vi.useRealTimers()
  })

  it('allows a new call after the wait period has elapsed', () => {
    vi.useFakeTimers()

    const spy = vi.fn()
    const throttled = throttle(spy, 100)

    throttled()
    expect(spy).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(100)

    throttled()
    expect(spy).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('preserves this context on leading call', () => {
    vi.useFakeTimers()

    const obj = {
      value: 42,
      throttled: throttle(function (this: { value: number }) {
        return this.value
      }, 100),
    }

    const spy = vi.fn()
    obj.throttled = throttle(function (this: { value: number }) {
      spy(this.value)
    }, 100)

    obj.throttled()
    expect(spy).toHaveBeenCalledWith(42)

    vi.useRealTimers()
  })

  it('preserves this context on trailing call', () => {
    vi.useFakeTimers()

    const spy = vi.fn()
    const obj = {
      value: 42,
      throttled: throttle(function (this: { value: number }) {
        spy(this.value)
      }, 100),
    }

    obj.throttled()
    obj.throttled()

    vi.advanceTimersByTime(100)

    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenLastCalledWith(42)

    vi.useRealTimers()
  })

  it('does not fire trailing call if no calls during wait', () => {
    vi.useFakeTimers()

    const spy = vi.fn()
    const throttled = throttle(spy, 100)

    throttled()
    expect(spy).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(200)

    expect(spy).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })
})
