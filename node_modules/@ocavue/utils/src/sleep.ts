/**
 * Returns a Promise that resolves after a specified number of milliseconds.
 *
 * @param ms - The number of milliseconds to wait.
 *
 * @example
 * ```js
 * await sleep(1000)  // Wait 1 second
 * ```
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
