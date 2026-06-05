/**
 * Formats a number of bytes into a human-readable string.
 * @param bytes - The number of bytes to format.
 * @returns A string representing the number of bytes in a human-readable format.
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let unitIndex = 0
  let num = bytes
  while (Math.abs(num) >= 1024 && unitIndex < units.length - 1) {
    num /= 1024
    unitIndex++
  }
  const fraction = unitIndex === 0 && num % 1 === 0 ? 0 : 1
  return `${num.toFixed(fraction)}${units[unitIndex]}`
}
