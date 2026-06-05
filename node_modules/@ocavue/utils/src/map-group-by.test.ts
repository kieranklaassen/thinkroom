import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { mapGroupBy, mapGroupByPolyfill } from './map-group-by'

const testCases = [
  { name: 'mapGroupBy', fn: mapGroupBy },
  { name: 'mapGroupByPolyfill', fn: mapGroupByPolyfill },
]

describe.each(testCases)('$name', ({ fn }) => {
  it('groups items by key', () => {
    const items = [1, 2, 3, 4, 5, 6]
    const result = fn(items, (item) => item % 2)

    expect(result.get(0)).toEqual([2, 4, 6])
    expect(result.get(1)).toEqual([1, 3, 5])
  })

  it('works with string keys', () => {
    const items = ['apple', 'banana', 'apricot', 'blueberry']
    const result = fn(items, (item) => item[0])

    expect(result.get('a')).toEqual(['apple', 'apricot'])
    expect(result.get('b')).toEqual(['banana', 'blueberry'])
  })

  it('works with object keys', () => {
    const keyA = { type: 'A' }
    const keyB = { type: 'B' }
    const items = [1, 2, 3, 4]
    const result = fn(items, (item) => (item % 2 === 0 ? keyA : keyB))

    expect(result.get(keyA)).toEqual([2, 4])
    expect(result.get(keyB)).toEqual([1, 3])
  })

  it('passes index to key selector', () => {
    const items = ['a', 'b', 'c', 'd']
    const result = fn(items, (_, index) => Math.floor(index / 2))

    expect(result.get(0)).toEqual(['a', 'b'])
    expect(result.get(1)).toEqual(['c', 'd'])
  })

  it('handles empty array', () => {
    const result = fn([], (item) => item)
    expect(result.size).toBe(0)
  })

  it('handles single item', () => {
    const result = fn([42], (item) => item)
    expect(result.get(42)).toEqual([42])
  })

  it('handles all items mapping to same key', () => {
    const items = [1, 2, 3, 4]
    const result = fn(items, () => 'same')

    expect(result.size).toBe(1)
    expect(result.get('same')).toEqual([1, 2, 3, 4])
  })

  it('works with iterables other than arrays', () => {
    const set = new Set([1, 2, 3, 4, 5])
    const result = fn(set, (item) => item % 2)

    expect(result.get(0)).toEqual([2, 4])
    expect(result.get(1)).toEqual([1, 3, 5])
  })
})

describe('mapGroupBy', () => {
  beforeEach(() => {
    if ('groupBy' in Map) {
      // @ts-expect-error - spy
      vi.spyOn(Map, 'groupBy', 'get').mockReturnValueOnce(undefined)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to polyfill when Map.groupBy is not available', () => {
    const items = [1, 2, 3, 4, 5, 6]
    const result = mapGroupBy(items, (item) => item % 2)

    expect(result.get(0)).toEqual([2, 4, 6])
    expect(result.get(1)).toEqual([1, 3, 5])
  })
})
