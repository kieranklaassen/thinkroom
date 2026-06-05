// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { isDeepEqual } from './is-deep-equal'

describe('isDeepEqual', () => {
  describe('primitives', () => {
    it('returns true for identical primitives', () => {
      expect(isDeepEqual(42, 42)).toBe(true)
      expect(isDeepEqual('hello', 'hello')).toBe(true)
      expect(isDeepEqual(true, true)).toBe(true)
      expect(isDeepEqual(false, false)).toBe(true)
      expect(isDeepEqual(null, null)).toBe(true)
      expect(isDeepEqual(undefined, undefined)).toBe(true)
    })

    it('returns false for different primitives', () => {
      expect(isDeepEqual(42, 43)).toBe(false)
      expect(isDeepEqual('hello', 'world')).toBe(false)
      expect(isDeepEqual(true, false)).toBe(false)
    })

    it('returns false for different types', () => {
      expect(isDeepEqual(42, '42')).toBe(false)
      expect(isDeepEqual(0, false)).toBe(false)
      expect(isDeepEqual('', false)).toBe(false)
      expect(isDeepEqual(null, undefined)).toBe(false)
    })

    it('handles NaN correctly', () => {
      expect(isDeepEqual(Number.NaN, Number.NaN)).toBe(true)
      expect(isDeepEqual(Number.NaN, 0)).toBe(false)
    })

    it('returns false when comparing null or undefined with other values', () => {
      expect(isDeepEqual(null, 0)).toBe(false)
      expect(isDeepEqual(undefined, 0)).toBe(false)
      expect(isDeepEqual(null, '')).toBe(false)
      expect(isDeepEqual(undefined, '')).toBe(false)
    })
  })

  describe('arrays', () => {
    it('returns true for identical arrays', () => {
      expect(isDeepEqual([], [])).toBe(true)
      expect(isDeepEqual([1, 2, 3], [1, 2, 3])).toBe(true)
      expect(isDeepEqual(['a', 'b'], ['a', 'b'])).toBe(true)
    })

    it('returns false for arrays with different lengths', () => {
      expect(isDeepEqual([1, 2], [1, 2, 3])).toBe(false)
      expect(isDeepEqual([1], [])).toBe(false)
    })

    it('returns false for arrays with different values', () => {
      expect(isDeepEqual([1, 2, 3], [1, 2, 4])).toBe(false)
      expect(isDeepEqual(['a', 'b'], ['a', 'c'])).toBe(false)
    })

    it('handles nested arrays', () => {
      expect(
        isDeepEqual(
          [
            [1, 2],
            [3, 4],
          ],
          [
            [1, 2],
            [3, 4],
          ],
        ),
      ).toBe(true)
      expect(
        isDeepEqual(
          [
            [1, 2],
            [3, 4],
          ],
          [
            [1, 2],
            [3, 5],
          ],
        ),
      ).toBe(false)
    })
  })

  describe('objects', () => {
    it('returns true for identical objects', () => {
      expect(isDeepEqual({}, {})).toBe(true)
      expect(isDeepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
    })

    it('returns false for objects with different keys', () => {
      expect(isDeepEqual({ a: 1 }, { b: 1 })).toBe(false)
      expect(isDeepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false)
    })

    it('returns false for objects with different values', () => {
      expect(isDeepEqual({ a: 1 }, { a: 2 })).toBe(false)
      expect(isDeepEqual({ a: 'hello' }, { a: 'world' })).toBe(false)
    })

    it('handles nested objects', () => {
      expect(isDeepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true)
      expect(isDeepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false)
    })

    it('handles objects with arrays', () => {
      expect(isDeepEqual({ arr: [1, 2, 3] }, { arr: [1, 2, 3] })).toBe(true)
      expect(isDeepEqual({ arr: [1, 2, 3] }, { arr: [1, 2, 4] })).toBe(false)
    })
  })

  describe('Sets', () => {
    it('returns true for identical sets', () => {
      expect(isDeepEqual(new Set(), new Set())).toBe(true)
      expect(isDeepEqual(new Set([1, 2, 3]), new Set([1, 2, 3]))).toBe(true)
      expect(isDeepEqual(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(true)
    })

    it('returns false for sets with different sizes', () => {
      expect(isDeepEqual(new Set([1, 2]), new Set([1, 2, 3]))).toBe(false)
      expect(isDeepEqual(new Set([1]), new Set())).toBe(false)
    })

    it('returns false for sets with different values', () => {
      expect(isDeepEqual(new Set([1, 2, 3]), new Set([1, 2, 4]))).toBe(false)
      expect(isDeepEqual(new Set(['a', 'b']), new Set(['a', 'c']))).toBe(false)
    })

    it('handles set order independence', () => {
      expect(isDeepEqual(new Set([1, 2, 3]), new Set([3, 2, 1]))).toBe(true)
    })
  })

  describe('Maps', () => {
    it('returns true for identical maps', () => {
      expect(isDeepEqual(new Map(), new Map())).toBe(true)
      expect(
        isDeepEqual(
          new Map([
            ['a', 1],
            ['b', 2],
          ]),
          new Map([
            ['a', 1],
            ['b', 2],
          ]),
        ),
      ).toBe(true)
    })

    it('returns false for maps with different sizes', () => {
      expect(
        isDeepEqual(
          new Map([['a', 1]]),
          new Map([
            ['a', 1],
            ['b', 2],
          ]),
        ),
      ).toBe(false)
    })

    it('returns false for maps with different keys', () => {
      expect(isDeepEqual(new Map([['a', 1]]), new Map([['b', 1]]))).toBe(false)
    })

    it('returns false for maps with different values', () => {
      expect(isDeepEqual(new Map([['a', 1]]), new Map([['a', 2]]))).toBe(false)
    })

    it('handles nested values in maps', () => {
      expect(
        isDeepEqual(new Map([['a', { b: 1 }]]), new Map([['a', { b: 1 }]])),
      ).toBe(true)
      expect(
        isDeepEqual(new Map([['a', { b: 1 }]]), new Map([['a', { b: 2 }]])),
      ).toBe(false)
    })

    it('handles arrays as map values', () => {
      expect(
        isDeepEqual(new Map([['a', [1, 2, 3]]]), new Map([['a', [1, 2, 3]]])),
      ).toBe(true)
      expect(
        isDeepEqual(new Map([['a', [1, 2, 3]]]), new Map([['a', [1, 2, 4]]])),
      ).toBe(false)
    })
  })

  describe('mixed types', () => {
    it('returns false when comparing different collection types', () => {
      expect(isDeepEqual([], {})).toBe(false)
      expect(isDeepEqual(new Set(), new Map())).toBe(false)
      expect(isDeepEqual(new Set([1, 2]), [1, 2])).toBe(false)
      expect(isDeepEqual(new Map(), {})).toBe(false)
    })

    it('handles complex nested structures', () => {
      const obj1 = {
        arr: [1, 2, { nested: true }],
        map: new Map([['key', [1, 2, 3]]]),
        set: new Set([1, 2, 3]),
      }
      const obj2 = {
        arr: [1, 2, { nested: true }],
        map: new Map([['key', [1, 2, 3]]]),
        set: new Set([1, 2, 3]),
      }
      const obj3 = {
        arr: [1, 2, { nested: false }],
        map: new Map([['key', [1, 2, 3]]]),
        set: new Set([1, 2, 3]),
      }

      expect(isDeepEqual(obj1, obj2)).toBe(true)
      expect(isDeepEqual(obj1, obj3)).toBe(false)
    })
  })
})
