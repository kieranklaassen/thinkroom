// @vitest-environment node

import { describe, it, expect } from 'vitest'

import { DefaultMap, DefaultWeakMap } from './default-map'

describe('DefaultMap', () => {
  it('creates default values for missing keys', () => {
    const map = new DefaultMap<string, number>(() => 0)

    expect(map.get('key1')).toBe(0)
    expect(map.get('key2')).toBe(0)
  })

  it('returns existing values for set keys', () => {
    const map = new DefaultMap<string, number>(() => 0)

    map.set('key1', 42)
    expect(map.get('key1')).toBe(42)
  })

  it('stores the default value when accessing missing key', () => {
    const map = new DefaultMap<string, number>(() => 5)

    const value = map.get('key1')
    expect(value).toBe(5)
    expect(map.has('key1')).toBe(true)
    expect(map.get('key1')).toBe(5)
  })

  it('works with array factory', () => {
    const map = new DefaultMap<string, string[]>(() => [])

    map.get('key1').push('item1')
    map.get('key1').push('item2')
    map.get('key2').push('item3')

    expect(map.get('key1')).toEqual(['item1', 'item2'])
    expect(map.get('key2')).toEqual(['item3'])
  })

  it('works with object factory', () => {
    const map = new DefaultMap<string, { count: number }>(() => ({
      count: 0,
    }))

    map.get('key1').count += 1
    map.get('key1').count += 1
    map.get('key2').count += 5

    expect(map.get('key1').count).toBe(2)
    expect(map.get('key2').count).toBe(5)
  })

  it('accepts initial entries via array', () => {
    const initialEntries: [string, number][] = [
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]
    const map = new DefaultMap<string, number>(() => 0, initialEntries)

    expect(map.get('a')).toBe(1)
    expect(map.get('b')).toBe(2)
    expect(map.get('c')).toBe(3)
    expect(map.get('d')).toBe(0)
  })

  it('accepts initial entries via non-array iterable', () => {
    const existingMap = new Map<string, number>([
      ['x', 10],
      ['y', 20],
      ['z', 30],
    ])
    const map = new DefaultMap<string, number>(() => 0, existingMap)

    expect(map.get('x')).toBe(10)
    expect(map.get('y')).toBe(20)
    expect(map.get('z')).toBe(30)
    expect(map.get('w')).toBe(0)
  })

  it('calls factory function only when key is missing', () => {
    let callCount = 0
    const map = new DefaultMap<string, number>(() => {
      callCount++
      return 42
    })

    map.set('existing', 100)

    map.get('existing')
    expect(callCount).toBe(0)

    map.get('new')
    expect(callCount).toBe(1)

    map.get('new')
    expect(callCount).toBe(1)

    map.get('another')
    expect(callCount).toBe(2)
  })

  it('works with size property', () => {
    const map = new DefaultMap<string, number>(() => 0)

    expect(map.size).toBe(0)

    map.get('key1')
    expect(map.size).toBe(1)

    map.get('key2')
    expect(map.size).toBe(2)

    map.get('key1')
    expect(map.size).toBe(2)
  })

  it('works with delete method', () => {
    const map = new DefaultMap<string, number>(() => 10)

    map.get('key1')
    expect(map.has('key1')).toBe(true)

    map.delete('key1')
    expect(map.has('key1')).toBe(false)

    const value = map.get('key1')
    expect(value).toBe(10)
    expect(map.has('key1')).toBe(true)
  })

  it('works with clear method', () => {
    const map = new DefaultMap<string, number>(() => 0)

    map.get('key1')
    map.get('key2')
    expect(map.size).toBe(2)

    map.clear()
    expect(map.size).toBe(0)
    expect(map.has('key1')).toBe(false)
  })

  it('works with iteration methods', () => {
    const map = new DefaultMap<string, number>(
      () => 0,
      [
        ['a', 1],
        ['b', 2],
      ],
    )

    expect([...map.keys()]).toEqual(['a', 'b'])
    expect([...map.values()]).toEqual([1, 2])
    expect([...map.entries()]).toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })

  it('creates independent default values', () => {
    const map = new DefaultMap<string, number[]>(() => [])

    map.get('key1').push(1)
    map.get('key2').push(2)

    expect(map.get('key1')).toEqual([1])
    expect(map.get('key2')).toEqual([2])
  })

  it('works with nested DefaultMaps', () => {
    const map = new DefaultMap<string, DefaultMap<string, number>>(
      () => new DefaultMap<string, number>(() => 0),
    )

    map.get('group1').get('item1')
    map.get('group1').set('item2', 5)
    map.get('group2').get('item1')

    expect(map.get('group1').get('item1')).toBe(0)
    expect(map.get('group1').get('item2')).toBe(5)
    expect(map.get('group2').get('item1')).toBe(0)
  })
})

describe('DefaultWeakMap', () => {
  it('creates default values for missing keys', () => {
    const map = new DefaultWeakMap<object, number>(() => 0)
    const key1 = {}
    const key2 = {}

    expect(map.get(key1)).toBe(0)
    expect(map.get(key2)).toBe(0)
  })

  it('returns existing values for set keys', () => {
    const map = new DefaultWeakMap<object, number>(() => 0)
    const key = {}

    map.set(key, 42)
    expect(map.get(key)).toBe(42)
  })

  it('stores the default value when accessing missing key', () => {
    const map = new DefaultWeakMap<object, number>(() => 5)
    const key = {}

    const value = map.get(key)
    expect(value).toBe(5)
    expect(map.has(key)).toBe(true)
    expect(map.get(key)).toBe(5)
  })

  it('works with array factory', () => {
    const map = new DefaultWeakMap<object, string[]>(() => [])
    const key1 = {}
    const key2 = {}

    map.get(key1).push('item1')
    map.get(key1).push('item2')
    map.get(key2).push('item3')

    expect(map.get(key1)).toEqual(['item1', 'item2'])
    expect(map.get(key2)).toEqual(['item3'])
  })

  it('accepts initial entries', () => {
    const key1 = {}
    const key2 = {}
    const key3 = {}
    const initialEntries: [object, number][] = [
      [key1, 1],
      [key2, 2],
      [key3, 3],
    ]
    const map = new DefaultWeakMap<object, number>(() => 0, initialEntries)

    expect(map.get(key1)).toBe(1)
    expect(map.get(key2)).toBe(2)
    expect(map.get(key3)).toBe(3)

    const key4 = {}
    expect(map.get(key4)).toBe(0)
  })

  it('calls factory function only when key is missing', () => {
    let callCount = 0
    const map = new DefaultWeakMap<object, number>(() => {
      callCount++
      return 42
    })
    const existing = {}
    const newKey = {}

    map.set(existing, 100)

    map.get(existing)
    expect(callCount).toBe(0)

    map.get(newKey)
    expect(callCount).toBe(1)

    map.get(newKey)
    expect(callCount).toBe(1)
  })

  it('works with delete method', () => {
    const map = new DefaultWeakMap<object, number>(() => 10)
    const key = {}

    map.get(key)
    expect(map.has(key)).toBe(true)

    map.delete(key)
    expect(map.has(key)).toBe(false)

    const value = map.get(key)
    expect(value).toBe(10)
    expect(map.has(key)).toBe(true)
  })
})
