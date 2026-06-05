/**
 * Creates a new object with the same keys as the input object, but with values
 * transformed by the provided callback function. Similar to `Array.prototype.map()`
 * but for object values.

 * @param object - The object whose values will be transformed.
 * @param callback - A function that transforms each value. Receives the value and
 *   its corresponding key as arguments.
 * @returns A new object with the same keys but transformed values.
 *
 * @example
 * ```typescript
 * const prices = { apple: 1, banana: 2, orange: 3 }
 * const doubled = mapValues(prices, (price) => price * 2)
 * // Result: { apple: 2, banana: 4, orange: 6 }
 * ```
 *
 * @example
 * ```typescript
 * const users = { john: 25, jane: 30, bob: 35 }
 * const greetings = mapValues(users, (age, name) => `${name} is ${age} years old`)
 * // Result: { john: 'john is 25 years old', jane: 'jane is 30 years old', bob: 'bob is 35 years old' }
 * ```
 *
 * @example
 * ```typescript
 * const data = { a: '1', b: '2', c: '3' }
 * const numbers = mapValues(data, (str) => parseInt(str, 10))
 * // Result: { a: 1, b: 2, c: 3 }
 * ```
 *
 * @public
 */
export function mapValues<ValueIn, ValueOut>(
  object: Record<string, ValueIn>,
  callback: (value: ValueIn, key: string) => ValueOut,
): Record<string, ValueOut> {
  const result = {} as Record<string, ValueOut>
  for (const [key, value] of Object.entries(object)) {
    result[key] = callback(value, key)
  }
  return result
}
