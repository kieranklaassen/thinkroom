// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { mapValues } from './map-values'

describe('mapValues', () => {
  it('transforms values with callback function', () => {
    const prices = { apple: 1, banana: 2, orange: 3 }
    const doubled = mapValues(prices, (price) => price * 2)

    expect(doubled).toEqual({ apple: 2, banana: 4, orange: 6 })
  })

  it('provides key to callback function', () => {
    const users = { john: 25, jane: 30 }
    const greetings = mapValues(
      users,
      (age, name) => `${name} is ${age} years old`,
    )

    expect(greetings).toEqual({
      john: 'john is 25 years old',
      jane: 'jane is 30 years old',
    })
  })

  it('handles empty objects', () => {
    const empty = {}
    const result = mapValues(empty, (value) => value)

    expect(result).toEqual({})
  })

  it('transforms value types', () => {
    const data = { a: '1', b: '2', c: '3' }
    const numbers = mapValues(data, (str) => Number.parseInt(str, 10))

    expect(numbers).toEqual({ a: 1, b: 2, c: 3 })
  })
})
