/**
 * A TypeScript utility type that represents the entries of an object as a union of tuple types.
 * Each tuple contains a key-value pair where the key and value types are precisely typed
 * according to the input object type.
 *
 * @example
 * ```typescript
 * type MyObject = { a: 1; b: 'B' }
 * type MyEntries = ObjectEntries<MyObject>
 * //   ^ ["a", 1] | ["b", "B"]
 * ```
 *
 * @public
 */
export type ObjectEntries<T extends Record<string, any>> = {
  [K in keyof T]: [K, T[K]]
}[keyof T]

/**
 * A type-safe wrapper around
 * [`Object.entries()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/entries)
 * that preserves the exact types of object keys and values. Unlike the standard
 * `Object.entries()` which returns `[string, any][]`, this function returns an
 * array of tuples where each tuple is precisely typed according to the input
 * object's structure.
 *
 * This is particularly useful when working with objects that have known, fixed
 * property types and you want to maintain type safety when iterating over
 * entries.
 *
 * @example
 * ```typescript
 * const myObject = { a: 1, b: 'hello', c: true } as const
 * const entries = objectEntries(myObject)
 * // Type: (["a", 1] | ["b", "hello"] | ["c", true])[]
 *
 * for (const [key, value] of entries) {
 *   // key is typed as "a" | "b" | "c"
 *   // value is typed as 1 | "hello" | true
 *   console.log(`${key}: ${value}`)
 * }
 * ```
 *
 * @example
 * ```typescript
 * interface User {
 *   name: string
 *   age: number
 *   active: boolean
 * }
 *
 * const user: User = { name: 'Alice', age: 30, active: true }
 * const entries = objectEntries(user)
 * // Type: (["name", string] | ["age", number] | ["active", boolean])[]
 * ```
 *
 * @public
 */
export function objectEntries<T extends Record<string, any>>(
  obj: T,
): ObjectEntries<T>[] {
  return Object.entries(obj)
}
