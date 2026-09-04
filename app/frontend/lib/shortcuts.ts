/** Chrome shortcuts must not overlap a richer chord or consume text entry. */
export function matchesShortcut(event: KeyboardEvent, code: string, shift = false): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) return false
  if (event.metaKey === event.ctrlKey || event.altKey) return false
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, select') ||
      (target?.closest('[contenteditable="true"]') && !target.closest('.ProseMirror'))) return false
  // Some layouts need Shift on another key to type a period. Preserve that
  // existing focus chord; only shifted physical Period cycles appearance.
  if (code === 'Period' && event.code !== 'Period' && event.key === '.') return !shift
  if (event.shiftKey !== shift) return false
  const key = code === 'Period' ? '.' : code === 'Backslash' ? '\\' : code.replace('Digit', '')
  return event.code === code || (!shift && event.key === key)
}
