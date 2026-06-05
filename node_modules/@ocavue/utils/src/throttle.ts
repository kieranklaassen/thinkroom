/**
 * Creates a throttled function that only invokes `fn` at most once per every
 * `wait` milliseconds. The first call executes immediately (leading edge).
 * If called again during the wait period, the last call will be executed at
 * the end of the wait period (trailing edge).
 *
 * @param callback The function to throttle
 * @param wait The number of milliseconds to throttle invocations to
 * @returns A throttled version of the function
 * @example
 * ```js
 * const throttled = throttle((name) => console.log('called', name), 1000)
 * throttled('Alice') // logs 'called Alice' immediately
 * throttled('Bob') // skipped (within 1000ms)
 * throttled('Charlie') // skipped (within 1000ms)
 * // after 1000ms, logs 'called Charlie' again (trailing call)
 * ```
 */
export function throttle<T extends (this: any, ...args: any[]) => unknown>(
  callback: T,
  wait: number,
): (this: ThisParameterType<T>, ...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let lastCallTime = 0

  return function throttled(
    this: ThisParameterType<T>,
    ...args: Parameters<T>
  ): void {
    clearTimeout(timeoutId)

    const now = Date.now()
    const delay = wait + lastCallTime - now

    if (delay <= 0) {
      lastCallTime = now
      callback.apply(this, args)
    } else {
      timeoutId = setTimeout(() => {
        lastCallTime = Date.now()
        callback.apply(this, args)
      }, delay)
    }
  }
}
