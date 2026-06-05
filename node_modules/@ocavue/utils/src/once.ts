/**
 * Creates a function that will only execute the provided function once.
 * Subsequent calls will return the cached result from the first execution.
 *
 * @param fn The function to execute once
 * @returns A function that will only execute the provided function once
 * @example
 * ```ts
 * const getValue = once(() => expensiveOperation())
 * getValue() // executes expensiveOperation
 * getValue() // returns cached result
 * ```
 */
export function once<T>(fn: () => T): () => T {
  let called = false
  let result: T
  return () => {
    if (!called) {
      result = fn()
      called = true
      // @ts-expect-error - micro-optimization for memory management
      fn = undefined
    }
    return result
  }
}
