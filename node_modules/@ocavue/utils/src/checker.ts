/**
 * Checks if the given value is an object.
 */
export function isObject(
  value: unknown,
): value is Record<string | symbol | number, unknown> {
  return value != null && typeof value === 'object'
}

/**
 * Checks if the given value is a Map.
 */
export function isMap(value: unknown): value is Map<unknown, unknown> {
  return value instanceof Map
}

/**
 * Checks if the given value is a Set.
 */
export function isSet(value: unknown): value is Set<unknown> {
  return value instanceof Set
}

/**
 * Returns true if the given value is not null or undefined.
 */
export function isNotNullish<T>(value: T): value is NonNullable<T> {
  return value != null
}
