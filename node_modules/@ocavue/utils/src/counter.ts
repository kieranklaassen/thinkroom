/**
 * A map that counts occurrences of keys.
 *
 * @example
 * ```typescript
 * // Count word occurrences
 * const wordCounter = new Counter<string>()
 * const words = ['apple', 'banana', 'apple', 'cherry', 'banana', 'apple']
 *
 * for (const word of words) {
 *   wordCounter.increment(word)
 * }
 *
 * console.log(wordCounter.get('apple'))   // 3
 * console.log(wordCounter.get('banana'))  // 2
 * console.log(wordCounter.get('cherry'))  // 1
 * console.log(wordCounter.get('orange'))  // 0 (defaults to 0)
 * ```
 *
 * @example
 * ```typescript
 * // Initialize with existing counts
 * const counter = new Counter<string>([
 *   ['red', 5],
 *   ['blue', 3],
 *   ['green', 7]
 * ])
 *
 * counter.increment('red', 2)      // red: 5 -> 7
 * counter.decrement('blue')        // blue: 3 -> 2
 * counter.increment('yellow')      // yellow: 0 -> 1
 *
 * console.log(counter.get('red'))    // 7
 * console.log(counter.get('blue'))   // 2
 * console.log(counter.get('yellow')) // 1
 * ```
 *
 * @example
 * ```typescript
 * // Track event frequencies
 * const eventCounter = new Counter<string>()
 *
 * eventCounter.increment('click', 5)
 * eventCounter.increment('hover', 3)
 * eventCounter.increment('click', 2)
 *
 * // Get most common events
 * const events = [...eventCounter.entries()]
 *   .sort((a, b) => b[1] - a[1])
 *
 * console.log(events) // [['click', 7], ['hover', 3]]
 * ```
 */
export class Counter<K> extends Map<K, number> {
  constructor(iterable?: Iterable<readonly [K, number]>) {
    super(iterable)
  }

  override get(key: K): number {
    return super.get(key) ?? 0
  }

  /**
   * Increments the count for a key by a given amount (default 1).
   */
  increment(key: K, amount = 1): void {
    this.set(key, this.get(key) + amount)
  }

  /**
   * Decrements the count for a key by a given amount (default 1).
   */
  decrement(key: K, amount = 1): void {
    this.set(key, this.get(key) - amount)
  }
}

/**
 * A weak map that counts occurrences of object keys.
 *
 * Similar to {@link Counter} but uses WeakMap as the base, allowing garbage collection of keys.
 *
 * @example
 * ```typescript
 * // Track reference counts for DOM elements
 * const elementRefs = new WeakCounter<HTMLElement>()
 *
 * function addReference(element: HTMLElement) {
 *   elementRefs.increment(element)
 *   console.log(`References: ${elementRefs.get(element)}`)
 * }
 *
 * function removeReference(element: HTMLElement) {
 *   elementRefs.decrement(element)
 *   console.log(`References: ${elementRefs.get(element)}`)
 * }
 *
 * const div = document.createElement('div')
 * addReference(div)     // References: 1
 * addReference(div)     // References: 2
 * removeReference(div)  // References: 1
 * ```
 *
 * @example
 * ```typescript
 * // Count object interactions without preventing garbage collection
 * const objectInteractions = new WeakCounter<object>()
 *
 * function handleInteraction(obj: object, count = 1) {
 *   objectInteractions.increment(obj, count)
 * }
 *
 * const user = { id: 1, name: 'Alice' }
 * const session = { sessionId: 'abc123' }
 *
 * handleInteraction(user, 3)
 * handleInteraction(session, 1)
 * handleInteraction(user, 2)
 *
 * console.log(objectInteractions.get(user))     // 5
 * console.log(objectInteractions.get(session))  // 1
 * // When user and session are no longer referenced elsewhere,
 * // they can be garbage collected along with their counts
 * ```
 *
 * @example
 * ```typescript
 * // Initialize with existing counts
 * const cache1 = {}
 * const cache2 = {}
 * const cache3 = {}
 *
 * const hitCounter = new WeakCounter<object>([
 *   [cache1, 10],
 *   [cache2, 5],
 *   [cache3, 15]
 * ])
 *
 * hitCounter.increment(cache1, 3)  // 10 -> 13
 * console.log(hitCounter.get(cache1))  // 13
 * console.log(hitCounter.get(cache2))  // 5
 * ```
 */
export class WeakCounter<K extends WeakKey> extends WeakMap<K, number> {
  constructor(entries?: readonly (readonly [K, number])[] | null) {
    super(entries)
  }

  override get(key: K): number {
    return super.get(key) ?? 0
  }

  /**
   * Increments the count for a key by a given amount (default 1).
   */
  increment(key: K, amount = 1): void {
    this.set(key, this.get(key) + amount)
  }

  /**
   * Decrements the count for a key by a given amount (default 1).
   */
  decrement(key: K, amount = 1): void {
    this.set(key, this.get(key) - amount)
  }
}
