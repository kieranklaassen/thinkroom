/**
 * @internal
 */
export function mapGroupByPolyfill<K, T>(
  items: Iterable<T>,
  keySelector: (item: T, index: number) => K,
): Map<K, T[]> {
  const map = new Map<K, T[]>()
  let index = 0
  for (const item of items) {
    const key = keySelector(item, index)
    const group = map.get(key)
    if (group) {
      group.push(item)
    } else {
      map.set(key, [item])
    }
    index++
  }
  return map
}

/**
 * A polyfill for the [`Map.groupBy()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map/groupBy) static method.
 *
 * @public
 */
export function mapGroupBy<K, T>(
  items: Iterable<T>,
  keySelector: (item: T, index: number) => K,
): Map<K, T[]> {
  return Map.groupBy
    ? Map.groupBy(items, keySelector)
    : mapGroupByPolyfill(items, keySelector)
}
