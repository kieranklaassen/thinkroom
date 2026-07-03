import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { nativeHaptic } from '@ruby-native/react'
import { useDismissable } from '../lib/use_dismissable'

// Only one row may sit open at a time (the iOS list convention). Opening a
// row registers its closer here; the next row to open — or a tap anywhere
// else — invokes it.
let closeOpenRow: (() => void) | null = null

const ACTION_WIDTH = 88
// Horizontal movement before we treat the gesture as a swipe (and start
// suppressing the row's own click/navigation).
const SLOP = 12

interface Props {
  slug: string
  deleting: boolean
  onDelete: () => void
  // Bump to force the row closed from the parent (e.g. after a failed
  // delete, so the error message isn't paired with a still-armed action).
  closeSignal?: number
  children: ReactNode
}

/**
 * iOS-style swipe-to-delete container for the native app's document rows.
 * Drag left past the threshold to reveal a Delete action; vertical movement
 * cancels so the list still scrolls; a tap on an open row closes it instead
 * of navigating. Dependency-free pointer-event implementation (the plan's
 * "Silk" library is not installed).
 */
export function SwipeRow({ slug, deleting, onDelete, closeSignal = 0, children }: Props) {
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState(false)
  // Disables the settle transition while the finger is down so the row
  // tracks the drag 1:1.
  const [dragging, setDragging] = useState(false)
  // Live offset for pointerup: the state value is a render-closure snapshot
  // and can be stale on a busy main thread (React may not re-render between
  // the last move and the release), which would snap the row closed.
  const offsetRef = useRef(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const axis = useRef<'horizontal' | 'vertical' | null>(null)
  // Sticky "this gesture was a swipe" flag: the click that follows a drag
  // must be suppressed even though pointerup already reset the drag state.
  const swiped = useRef(false)

  const close = useCallback(() => {
    setOpen(false)
    setOffset(0)
    offsetRef.current = 0
  }, [])

  useEffect(() => {
    if (!open) return
    closeOpenRow?.()
    closeOpenRow = close
    return () => {
      if (closeOpenRow === close) closeOpenRow = null
    }
  }, [open, close])

  // Parent-forced close (failed delete).
  useEffect(() => {
    if (closeSignal > 0) close()
  }, [closeSignal, close])

  // Tapping anywhere outside an open row closes it, per the registry
  // comment's contract (Escape too, via the shared popover hook).
  const rootRef = useRef<HTMLDivElement>(null)
  useDismissable(open, close, [rootRef])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    start.current = { x: event.clientX, y: event.clientY }
    axis.current = null
    swiped.current = false
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    const dx = event.clientX - start.current.x
    const dy = event.clientY - start.current.y
    if (!axis.current) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
      axis.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
      if (axis.current === 'horizontal') {
        swiped.current = true
        setDragging(true)
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Synthetic events may carry an unknown pointerId; capture is an
          // enhancement, not a requirement.
        }
      }
    }
    if (axis.current !== 'horizontal') return
    const base = open ? -ACTION_WIDTH : 0
    const next = Math.min(0, Math.max(-ACTION_WIDTH, base + dx))
    offsetRef.current = next
    setOffset(next)
  }

  const endGesture = () => {
    if (axis.current === 'horizontal') {
      const shouldOpen = offsetRef.current < -ACTION_WIDTH / 2
      setOpen(shouldOpen)
      const settled = shouldOpen ? -ACTION_WIDTH : 0
      offsetRef.current = settled
      setOffset(settled)
    }
    start.current = null
    axis.current = null
    setDragging(false)
  }

  // A click that follows a swipe (or lands on an open row) closes the row
  // and never reaches the Inertia link underneath.
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (swiped.current) {
      event.preventDefault()
      event.stopPropagation()
      swiped.current = false
      return
    }
    if (open) {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  return (
    <div ref={rootRef} className={`swipe-row${open ? ' is-open' : ''}`} data-swipe-row={slug}>
      <div className="swipe-row-action">
        <button
          type="button"
          disabled={deleting}
          onClick={onDelete}
          {...nativeHaptic('warning')}
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
      <div
        className={`swipe-row-content${dragging ? ' is-dragging' : ''}`}
        style={{ transform: offset === 0 ? undefined : `translateX(${offset}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  )
}
