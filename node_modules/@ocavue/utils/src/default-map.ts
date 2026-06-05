/**
 * A map that automatically creates values for missing keys using a factory function.
 *
 * Similar to Python's [defaultdict](https://docs.python.org/3.13/library/collections.html#collections.defaultdict).
 *
 * @example
 * ```typescript
 * // Group items by category using arrays
 * const groupByCategory = new DefaultMap<string, string[]>(() => [])
 *
 * groupByCategory.get('fruits').push('apple', 'banana')
 * groupByCategory.get('vegetables').push('carrot')
 * groupByCategory.get('fruits').push('orange')
 *
 * console.log(groupByCategory.get('fruits'))      // ['apple', 'banana', 'orange']
 * console.log(groupByCategory.get('vegetables'))  // ['carrot']
 * console.log(groupByCategory.get('dairy'))       // [] (auto-created)
 * ```
 *
 * @example
 * ```typescript
 * // Build a graph with adjacency lists
 * const graph = new DefaultMap<string, Set<string>>(() => new Set())
 *
 * graph.get('A').add('B').add('C')
 * graph.get('B').add('C').add('D')
 * graph.get('C').add('D')
 *
 * console.log([...graph.get('A')])  // ['B', 'C']
 * console.log([...graph.get('B')])  // ['C', 'D']
 * console.log([...graph.get('E')])  // [] (auto-created empty set)
 * ```
 *
 * @example
 * ```typescript
 * // Initialize with existing entries
 * const scores = new DefaultMap<string, number>(
 *   () => 0,
 *   [
 *     ['Alice', 100],
 *     ['Bob', 85]
 *   ]
 * )
 *
 * scores.set('Alice', scores.get('Alice') + 10)  // 100 -> 110
 * console.log(scores.get('Alice'))   // 110
 * console.log(scores.get('Bob'))     // 85
 * console.log(scores.get('Charlie')) // 0 (auto-created)
 * ```
 *
 * @example
 * ```typescript
 * // Nested DefaultMaps for 2D data structures
 * const matrix = new DefaultMap<number, DefaultMap<number, number>>(
 *   () => new DefaultMap<number, number>(() => 0)
 * )
 *
 * matrix.get(0).set(0, 1)
 * matrix.get(0).set(1, 2)
 * matrix.get(1).set(1, 3)
 *
 * console.log(matrix.get(0).get(0))  // 1
 * console.log(matrix.get(0).get(1))  // 2
 * console.log(matrix.get(1).get(0))  // 0 (auto-created)
 * console.log(matrix.get(2).get(3))  // 0 (both auto-created)
 * ```
 */
export class DefaultMap<K, V> extends Map<K, V> {
  private readonly defaultFactory: () => V

  constructor(defaultFactory: () => V, iterable?: Iterable<readonly [K, V]>) {
    super(iterable)
    this.defaultFactory = defaultFactory
  }

  override get(key: K): V {
    if (this.has(key)) {
      return super.get(key)!
    }
    const value = this.defaultFactory()
    this.set(key, value)
    return value
  }
}

/**
 * A weak map that automatically creates values for missing keys using a factory function.
 *
 * Similar to {@link DefaultMap} but uses WeakMap as the base, allowing garbage collection of keys.
 *
 * @example
 * ```typescript
 * // Store metadata for DOM elements without preventing garbage collection
 * const elementMetadata = new DefaultWeakMap<HTMLElement, { clicks: number; hovers: number }>(
 *   () => ({ clicks: 0, hovers: 0 })
 * )
 *
 * const button = document.querySelector('button')!
 * const div = document.querySelector('div')!
 *
 * elementMetadata.get(button).clicks++
 * elementMetadata.get(button).clicks++
 * elementMetadata.get(div).hovers++
 *
 * console.log(elementMetadata.get(button)) // { clicks: 2, hovers: 0 }
 * console.log(elementMetadata.get(div))    // { clicks: 0, hovers: 1 }
 * // When elements are removed from DOM and not referenced,
 * // their metadata can be garbage collected
 * ```
 *
 * @example
 * ```typescript
 * // Cache computed properties for objects
 * const computedCache = new DefaultWeakMap<object, Map<string, any>>(
 *   () => new Map()
 * )
 *
 * function getOrCompute(obj: object, key: string, compute: () => any) {
 *   const cache = computedCache.get(obj)
 *   if (!cache.has(key)) {
 *     cache.set(key, compute())
 *   }
 *   return cache.get(key)
 * }
 *
 * const user = { name: 'Alice', age: 30 }
 * const displayName = getOrCompute(user, 'displayName', () => user.name.toUpperCase())
 * const birthYear = getOrCompute(user, 'birthYear', () => new Date().getFullYear() - user.age)
 *
 * console.log(displayName) // 'ALICE'
 * console.log(birthYear)   // 1994 (or current year - 30)
 * ```
 *
 * @example
 * ```typescript
 * // Initialize with existing entries
 * const obj1 = {}
 * const obj2 = {}
 *
 * const objectData = new DefaultWeakMap<object, string[]>(
 *   () => [],
 *   [
 *     [obj1, ['tag1', 'tag2']],
 *     [obj2, ['tag3']]
 *   ]
 * )
 *
 * objectData.get(obj1).push('tag4')
 * console.log(objectData.get(obj1))  // ['tag1', 'tag2', 'tag4']
 * console.log(objectData.get(obj2))  // ['tag3']
 *
 * const obj3 = {}
 * console.log(objectData.get(obj3))  // [] (auto-created)
 * ```
 *
 * @example
 * ```typescript
 * // Track event listeners per element using both DefaultWeakMap and DefaultMap
 * const eventListeners = new DefaultWeakMap<EventTarget, DefaultMap<string, Function[]>>(
 *   () => new DefaultMap<string, Function[]>(() => [])
 * )
 *
 * function addListener(target: EventTarget, event: string, handler: Function) {
 *   eventListeners.get(target).get(event).push(handler)
 * }
 *
 * const element = document.createElement('button')
 * addListener(element, 'click', () => console.log('clicked'))
 * addListener(element, 'click', () => console.log('also clicked'))
 * addListener(element, 'hover', () => console.log('hovered'))
 *
 * console.log(eventListeners.get(element).get('click').length)  // 2
 * console.log(eventListeners.get(element).get('hover').length)  // 1
 * // No need for has() checks or null assertions - everything auto-initializes!
 * ```
 */
export class DefaultWeakMap<K extends WeakKey, V> extends WeakMap<K, V> {
  private readonly defaultFactory: () => V

  constructor(
    defaultFactory: () => V,
    entries?: readonly (readonly [K, V])[] | null,
  ) {
    super(entries)
    this.defaultFactory = defaultFactory
  }

  override get(key: K): V {
    if (this.has(key)) {
      return super.get(key)!
    }
    const value = this.defaultFactory()
    this.set(key, value)
    return value
  }
}
