// @vitest-environment node

import { describe, it, expect } from 'vitest'

import { Counter, WeakCounter } from './counter'

describe('Counter', () => {
  it('initializes counts to 0', () => {
    const counter = new Counter<string>()

    expect(counter.get('key1')).toBe(0)
    expect(counter.get('key2')).toBe(0)
  })

  it('increments counts', () => {
    const counter = new Counter<string>()

    counter.increment('key1')
    expect(counter.get('key1')).toBe(1)

    counter.increment('key1')
    expect(counter.get('key1')).toBe(2)

    counter.increment('key2')
    expect(counter.get('key2')).toBe(1)
  })

  it('increments by custom amounts', () => {
    const counter = new Counter<string>()

    counter.increment('key1', 5)
    expect(counter.get('key1')).toBe(5)

    counter.increment('key1', 3)
    expect(counter.get('key1')).toBe(8)
  })

  it('decrements counts', () => {
    const counter = new Counter<string>()

    counter.set('key1', 10)
    counter.decrement('key1')
    expect(counter.get('key1')).toBe(9)

    counter.decrement('key1')
    expect(counter.get('key1')).toBe(8)
  })

  it('decrements by custom amounts', () => {
    const counter = new Counter<string>()

    counter.set('key1', 10)
    counter.decrement('key1', 3)
    expect(counter.get('key1')).toBe(7)

    counter.decrement('key1', 2)
    expect(counter.get('key1')).toBe(5)
  })

  it('allows negative counts', () => {
    const counter = new Counter<string>()

    counter.decrement('key1')
    expect(counter.get('key1')).toBe(-1)

    counter.decrement('key1', 5)
    expect(counter.get('key1')).toBe(-6)
  })

  it('accepts initial entries', () => {
    const initialEntries: [string, number][] = [
      ['a', 5],
      ['b', 10],
      ['c', 15],
    ]
    const counter = new Counter<string>(initialEntries)

    expect(counter.get('a')).toBe(5)
    expect(counter.get('b')).toBe(10)
    expect(counter.get('c')).toBe(15)
    expect(counter.get('d')).toBe(0)
  })

  it('works with all Map methods', () => {
    const counter = new Counter<string>()

    counter.increment('key1')
    counter.increment('key2', 2)

    expect(counter.size).toBe(2)
    expect(counter.has('key1')).toBe(true)
    expect([...counter.keys()]).toEqual(['key1', 'key2'])
    expect([...counter.values()]).toEqual([1, 2])
  })
})

describe('WeakCounter', () => {
  it('initializes counts to 0', () => {
    const counter = new WeakCounter<object>()
    const key1 = {}
    const key2 = {}

    expect(counter.get(key1)).toBe(0)
    expect(counter.get(key2)).toBe(0)
  })

  it('increments counts', () => {
    const counter = new WeakCounter<object>()
    const key = {}

    counter.increment(key)
    expect(counter.get(key)).toBe(1)

    counter.increment(key)
    expect(counter.get(key)).toBe(2)
  })

  it('increments by custom amounts', () => {
    const counter = new WeakCounter<object>()
    const key = {}

    counter.increment(key, 5)
    expect(counter.get(key)).toBe(5)

    counter.increment(key, 3)
    expect(counter.get(key)).toBe(8)
  })

  it('decrements counts', () => {
    const counter = new WeakCounter<object>()
    const key = {}

    counter.set(key, 10)
    counter.decrement(key)
    expect(counter.get(key)).toBe(9)

    counter.decrement(key)
    expect(counter.get(key)).toBe(8)
  })

  it('decrements by custom amounts', () => {
    const counter = new WeakCounter<object>()
    const key = {}

    counter.set(key, 10)
    counter.decrement(key, 3)
    expect(counter.get(key)).toBe(7)

    counter.decrement(key, 2)
    expect(counter.get(key)).toBe(5)
  })

  it('allows negative counts', () => {
    const counter = new WeakCounter<object>()
    const key = {}

    counter.decrement(key)
    expect(counter.get(key)).toBe(-1)

    counter.decrement(key, 5)
    expect(counter.get(key)).toBe(-6)
  })

  it('accepts initial entries', () => {
    const key1 = {}
    const key2 = {}
    const key3 = {}
    const initialEntries: [object, number][] = [
      [key1, 5],
      [key2, 10],
      [key3, 15],
    ]
    const counter = new WeakCounter<object>(initialEntries)

    expect(counter.get(key1)).toBe(5)
    expect(counter.get(key2)).toBe(10)
    expect(counter.get(key3)).toBe(15)

    const key4 = {}
    expect(counter.get(key4)).toBe(0)
  })

  it('works with WeakMap methods', () => {
    const counter = new WeakCounter<object>()
    const key1 = {}
    const key2 = {}

    counter.increment(key1)
    counter.increment(key2, 2)

    expect(counter.has(key1)).toBe(true)
    expect(counter.has(key2)).toBe(true)

    counter.delete(key1)
    expect(counter.has(key1)).toBe(false)
  })
})
