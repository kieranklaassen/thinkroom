import { useEffect, type RefObject } from 'react'

/**
 * Shared popover dismissal: outside mousedown or Escape closes. Pass every
 * ref that counts as "inside" (trigger root, portaled popover).
 */
export function useDismissable(
  open: boolean,
  onClose: () => void,
  refs: RefObject<HTMLElement | null>[],
): void {
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      const target = e.target as Node
      if (refs.some((ref) => ref.current?.contains(target))) return
      onClose()
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}
