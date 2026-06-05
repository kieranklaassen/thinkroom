import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { objectGroupBy, objectGroupByPolyfill } from './object-group-by'

const testCases = [
  { name: 'objectGroupBy', fn: objectGroupBy },
  { name: 'objectGroupByPolyfill', fn: objectGroupByPolyfill },
]

describe.each(testCases)('$name', ({ fn }) => {
  it('groups items by key', () => {
    const items = [1, 2, 3, 4, 5, 6]
    const result = fn(items, (item) => (item % 2 === 0 ? 'even' : 'odd'))

    expect(result.even).toEqual([2, 4, 6])
    expect(result.odd).toEqual([1, 3, 5])
  })

  it('works with string keys', () => {
    const items = ['apple', 'banana', 'apricot', 'blueberry']
    const result = fn(items, (item) => item[0])

    expect(result.a).toEqual(['apple', 'apricot'])
    expect(result.b).toEqual(['banana', 'blueberry'])
  })

  it('works with number keys', () => {
    const items = ['a', 'b', 'c', 'd']
    const result = fn(items, (_, index) => Math.floor(index / 2))

    expect(result[0]).toEqual(['a', 'b'])
    expect(result[1]).toEqual(['c', 'd'])
  })

  it('works with symbol keys', () => {
    const symA = Symbol('A')
    const symB = Symbol('B')
    const items = [1, 2, 3, 4]
    const result = fn(items, (item) => (item % 2 === 0 ? symA : symB))

    expect(result[symA]).toEqual([2, 4])
    expect(result[symB]).toEqual([1, 3])
  })

  it('passes index to key selector', () => {
    const items = ['a', 'b', 'c', 'd']
    const result = fn(items, (_, index) => (index < 2 ? 'first' : 'second'))

    expect(result.first).toEqual(['a', 'b'])
    expect(result.second).toEqual(['c', 'd'])
  })

  it('handles empty array', () => {
    const result = fn([], (item) => String(item))
    expect(Object.keys(result)).toHaveLength(0)
  })

  it('handles single item', () => {
    const result = fn([42], (item) => String(item))
    expect(result['42']).toEqual([42])
  })

  it('handles all items mapping to same key', () => {
    const items = [1, 2, 3, 4]
    const result = fn(items, () => 'same')

    expect(Object.keys(result)).toHaveLength(1)
    expect(result.same).toEqual([1, 2, 3, 4])
  })

  it('works with iterables other than arrays', () => {
    const set = new Set([1, 2, 3, 4, 5])
    const result = fn(set, (item) => (item % 2 === 0 ? 'even' : 'odd'))

    expect(result.even).toEqual([2, 4])
    expect(result.odd).toEqual([1, 3, 5])
  })
})

describe('objectGroupBy', () => {
  beforeEach(() => {
    if ('groupBy' in Object) {
      // @ts-expect-error - spy
      vi.spyOn(Object, 'groupBy', 'get').mockReturnValueOnce(undefined)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to polyfill when Object.groupBy is not available', () => {
    const items = [1, 2, 3, 4, 5, 6]
    const result = objectGroupBy(items, (item) =>
      item % 2 === 0 ? 'even' : 'odd',
    )

    expect(result.even).toEqual([2, 4, 6])
    expect(result.odd).toEqual([1, 3, 5])
  })
})
