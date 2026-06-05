let id = 0

let maxSafeInteger = Number.MAX_SAFE_INTEGER

/**
 * Sets the maximum safe integer for the id generator. Only for testing purposes.
 *
 * @internal
 */
export function setMaxSafeInteger(max: number) {
  maxSafeInteger = max
}

/**
 * Generates a unique positive integer.
 */
export function getId(): number {
  id++
  if (id >= maxSafeInteger) {
    id = 1
  }
  return id
}
