/** Chrome shortcuts must not overlap a richer chord or consume text entry. */
export function matchesShortcut(event: KeyboardEvent, code: string, shift = false): boolean {
  if (event.defaultPrevented || event.repeat || event.isComposing) return false
  if (event.metaKey === event.ctrlKey || event.altKey || event.shiftKey !== shift) return false
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('input, textarea, select') ||
      (target?.closest('[contenteditable="true"]') && !target.closest('.ProseMirror'))) return false
  const key = code === 'Period' ? '.' : code === 'Backslash' ? '\\' : code.replace('Digit', '')
  return event.code === code || event.key === key
}
