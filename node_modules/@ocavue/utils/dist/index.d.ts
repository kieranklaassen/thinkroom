//#region src/checker.d.ts
/**
 * Checks if the given value is an object.
 */
declare function isObject(value: unknown): value is Record<string | symbol | number, unknown>;
/**
 * Checks if the given value is a Map.
 */
declare function isMap(value: unknown): value is Map<unknown, unknown>;
/**
 * Checks if the given value is a Set.
 */
declare function isSet(value: unknown): value is Set<unknown>;
/**
 * Returns true if the given value is not null or undefined.
 */
declare function isNotNullish<T>(value: T): value is NonNullable<T>;
//#endregion
//#region src/counter.d.ts
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
declare class Counter<K> extends Map<K, number> {
  constructor(iterable?: Iterable<readonly [K, number]>);
  get(key: K): number;
  /**
   * Increments the count for a key by a given amount (default 1).
   */
  increment(key: K, amount?: number): void;
  /**
   * Decrements the count for a key by a given amount (default 1).
   */
  decrement(key: K, amount?: number): void;
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
declare class WeakCounter<K extends WeakKey> extends WeakMap<K, number> {
  constructor(entries?: readonly (readonly [K, number])[] | null);
  get(key: K): number;
  /**
   * Increments the count for a key by a given amount (default 1).
   */
  increment(key: K, amount?: number): void;
  /**
   * Decrements the count for a key by a given amount (default 1).
   */
  decrement(key: K, amount?: number): void;
}
//#endregion
//#region src/default-map.d.ts
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
declare class DefaultMap<K, V> extends Map<K, V> {
  private readonly defaultFactory;
  constructor(defaultFactory: () => V, iterable?: Iterable<readonly [K, V]>);
  get(key: K): V;
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
declare class DefaultWeakMap<K extends WeakKey, V> extends WeakMap<K, V> {
  private readonly defaultFactory;
  constructor(defaultFactory: () => V, entries?: readonly (readonly [K, V])[] | null);
  get(key: K): V;
}
//#endregion
//#region src/dom.d.ts
/**
 * Checks if the given DOM node is an Element.
 */
declare function isElement(node: Node): node is Element;
/**
 * Checks if the given DOM node is a Text node.
 */
declare function isTextNode(node: Node): node is Text;
/**
 * Checks if the given DOM node is an HTMLElement.
 */
declare function isHTMLElement(node: Node): node is HTMLElement;
/**
 * Checks if the given DOM node is an SVGElement.
 */
declare function isSVGElement(node: Node): node is SVGElement;
/**
 * Checks if the given DOM node is an MathMLElement.
 */
declare function isMathMLElement(node: Node): node is MathMLElement;
/**
 * Checks if the given DOM node is a Document.
 */
declare function isDocument(node: Node): node is Document;
/**
 * Checks if the given DOM node is a DocumentFragment.
 */
declare function isDocumentFragment(node: Node): node is DocumentFragment;
/**
 * Checks if the given DOM node is a ShadowRoot.
 */
declare function isShadowRoot(node: Node): node is ShadowRoot;
/**
 * Checks if an unknown value is likely a DOM node.
 */
declare function isNodeLike(value: unknown): value is Node;
/**
 * Checks if an unknown value is likely a DOM element.
 */
declare function isElementLike(value: unknown): value is Element;
/**
 * Checks if the given value is likely a Window object.
 */
declare function isWindowLike(value: unknown): value is Window;
/**
 * Gets the window object for the given target or the global window object if no
 * target is provided.
 */
declare function getWindow(target?: Node | ShadowRoot | Document | null): Window & typeof globalThis;
/**
 * Gets the document for the given target or the global document if no target is
 * provided.
 */
declare function getDocument(target?: Element | Window | Node | Document | null): Document;
/**
 * Gets a reference to the root node of the document based on the given target.
 */
declare function getDocumentElement(target?: Element | Node | Window | Document | null): HTMLElement;
//#endregion
//#region src/format-bytes.d.ts
/**
 * Formats a number of bytes into a human-readable string.
 * @param bytes - The number of bytes to format.
 * @returns A string representing the number of bytes in a human-readable format.
 */
declare function formatBytes(bytes: number): string;
//#endregion
//#region src/get-id.d.ts
/**
 * Generates a unique positive integer.
 */
declare function getId(): number;
//#endregion
//#region src/is-deep-equal.d.ts
/**
 * Whether two values are deeply equal.
 */
declare function isDeepEqual(a: unknown, b: unknown): boolean;
//#endregion
//#region src/map-group-by.d.ts
/**
 * A polyfill for the [`Map.groupBy()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map/groupBy) static method.
 *
 * @public
 */
declare function mapGroupBy<K, T>(items: Iterable<T>, keySelector: (item: T, index: number) => K): Map<K, T[]>;
//#endregion
//#region src/map-values.d.ts
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
declare function mapValues<ValueIn, ValueOut>(object: Record<string, ValueIn>, callback: (value: ValueIn, key: string) => ValueOut): Record<string, ValueOut>;
//#endregion
//#region src/object-entries.d.ts
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
type ObjectEntries<T extends Record<string, any>> = { [K in keyof T]: [K, T[K]] }[keyof T];
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
declare function objectEntries<T extends Record<string, any>>(obj: T): ObjectEntries<T>[];
//#endregion
//#region src/object-group-by.d.ts
/**
 * A polyfill for the [`Object.groupBy()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/groupBy) static method.
 *
 * @public
 */
declare function objectGroupBy<K extends PropertyKey, T>(items: Iterable<T>, keySelector: (item: T, index: number) => K): Partial<Record<K, T[]>>;
//#endregion
//#region src/once.d.ts
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
declare function once<T>(fn: () => T): () => T;
//#endregion
//#region src/regex.d.ts
/**
 * Checks if current environment supports [regex lookbehind assertion](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Lookbehind_assertion).
 *
 * @returns `true` if the current environment supports regex lookbehind assertion, `false` otherwise.
 */
declare const supportsRegexLookbehind: () => boolean;
//#endregion
//#region src/sleep.d.ts
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
declare function sleep(ms: number): Promise<void>;
//#endregion
//#region src/throttle.d.ts
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
declare function throttle<T extends (this: any, ...args: any[]) => unknown>(callback: T, wait: number): (this: ThisParameterType<T>, ...args: Parameters<T>) => void;
//#endregion
export { Counter, DefaultMap, DefaultWeakMap, type ObjectEntries, WeakCounter, formatBytes, getDocument, getDocumentElement, getId, getWindow, isDeepEqual, isDocument, isDocumentFragment, isElement, isElementLike, isHTMLElement, isMap, isMathMLElement, isNodeLike, isNotNullish, isObject, isSVGElement, isSet, isShadowRoot, isTextNode, isWindowLike, mapGroupBy, mapValues, objectEntries, objectGroupBy, once, sleep, supportsRegexLookbehind, throttle };