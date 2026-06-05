import { isMap, isSet } from './checker'

/**
 * Whether two values are deeply equal.
 */
export function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }

  // Handle null and undefined early
  if (a == null || b == null) {
    return false
  }

  const aType = typeof a
  const bType = typeof b
  if (aType !== bType) {
    return false
  }

  if (aType === 'number' && Number.isNaN(a) && Number.isNaN(b)) {
    return true
  }

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) {
      return false
    }
    if (a.length !== b.length) {
      return false
    }
    const size = a.length
    for (let i = 0; i < size; i++) {
      if (!isDeepEqual(a[i], b[i])) {
        return false
      }
    }
    return true
  }

  if (isSet(a)) {
    if (!isSet(b)) {
      return false
    }
    if (a.size !== b.size) {
      return false
    }
    for (const value of a) {
      if (!b.has(value)) {
        return false
      }
    }
    return true
  }

  if (isMap(a)) {
    if (!isMap(b)) {
      return false
    }
    if (a.size !== b.size) {
      return false
    }
    for (const key of a.keys()) {
      if (!b.has(key)) {
        return false
      }
      if (!isDeepEqual(a.get(key), b.get(key))) {
        return false
      }
    }
    return true
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) {
      return false
    }
    for (const key of aKeys) {
      if (
        !isDeepEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        )
      ) {
        return false
      }
    }
    return true
  }

  return false
}
