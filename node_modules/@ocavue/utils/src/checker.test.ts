// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { isMap, isNotNullish, isObject, isSet } from './checker'

describe('isObject', () => {
  it('returns true for plain objects', () => {
    expect(isObject({})).toBe(true)
    expect(isObject({ foo: 'bar' })).toBe(true)
  })

  it('returns true for arrays', () => {
    expect(isObject([])).toBe(true)
    expect(isObject(['foo'])).toBe(true)
  })

  it('returns false for null and undefined', () => {
    expect(isObject(null)).toBe(false)
    expect(isObject(undefined)).toBe(false)
  })

  it('returns false for primitives', () => {
    expect(isObject(42)).toBe(false)
    expect(isObject(42n)).toBe(false)
    expect(isObject(Number.NaN)).toBe(false)
    expect(isObject(Infinity)).toBe(false)
    expect(isObject(true)).toBe(false)
    expect(isObject(false)).toBe(false)
    expect(isObject(Symbol.iterator)).toBe(false)
    expect(isObject(Symbol.for('foo'))).toBe(false)
    expect(isObject(Symbol())).toBe(false)
    expect(isObject('string')).toBe(false)
  })

  it('returns true for class instances', () => {
    class TestClass {}
    expect(isObject(new TestClass())).toBe(true)
  })
})

describe('isMap', () => {
  it('returns true for Map instances', () => {
    expect(isMap(new Map())).toBe(true)
    expect(isMap(new Map([['key', 'value']]))).toBe(true)
  })

  it('returns false for non-Map values', () => {
    expect(isMap({})).toBe(false)
    expect(isMap([])).toBe(false)
    expect(isMap(new Set())).toBe(false)
    expect(isMap(null)).toBe(false)
    expect(isMap(undefined)).toBe(false)
    expect(isMap('map')).toBe(false)
    expect(isMap(42)).toBe(false)
  })
})

describe('isSet', () => {
  it('returns true for Set instances', () => {
    expect(isSet(new Set())).toBe(true)
    expect(isSet(new Set([1, 2, 3]))).toBe(true)
  })

  it('returns false for non-Set values', () => {
    expect(isSet({})).toBe(false)
    expect(isSet([])).toBe(false)
    expect(isSet(new Map())).toBe(false)
    expect(isSet(null)).toBe(false)
    expect(isSet(undefined)).toBe(false)
    expect(isSet('set')).toBe(false)
    expect(isSet(42)).toBe(false)
  })
})

describe('isNotNullish', () => {
  it('returns false for null and undefined', () => {
    expect(isNotNullish(null)).toBe(false)
    expect(isNotNullish(undefined)).toBe(false)
  })

  it('returns true for non-nullish values', () => {
    expect(isNotNullish(0)).toBe(true)
    expect(isNotNullish(-1)).toBe(true)
    expect(isNotNullish('')).toBe(true)
    expect(isNotNullish('hello')).toBe(true)
    expect(isNotNullish(true)).toBe(true)
    expect(isNotNullish(false)).toBe(true)
    expect(isNotNullish({})).toBe(true)
    expect(isNotNullish([])).toBe(true)
    expect(isNotNullish(new Map())).toBe(true)
    expect(isNotNullish(new Set())).toBe(true)
    expect(isNotNullish(0n)).toBe(true)
  })
})
