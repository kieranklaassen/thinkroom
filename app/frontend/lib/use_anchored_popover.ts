import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { EditorView } from '@milkdown/kit/prose/view'

export interface AnchorRange {
  from: number
  to: number
}

export interface AnchoredPosition {
  x: number
  y: number
  /** Anchor text vanished (e.g. remote edit) — frozen at the last good spot. */
  detached: boolean
}

interface Options {
  /** Whether the popover is open at all. False resets all placement state. */
  active: boolean
  /** Live view getter — geometry re-derives from current state every pass. */
  getView: () => EditorView | null
  /** Anchor range in the current doc, or null when the anchor is gone. */
  getRange: () => AnchorRange | null
  /** Place below the anchor's last line by default (composers); popovers
   *  default to above the first line. Either way the popover never covers
   *  the anchored text. */
  preferBelow?: boolean
  /** Keep the last good position when the anchor stops resolving instead of
   *  hiding — for stateful chrome (an open composer) that must not vanish
   *  mid-draft. */
  freezeWhenLost?: boolean
  /** Distance between anchor line and popover edge. */
  gap?: number
  /** Invalidation signals: scroll/resize tick, doc tick, anchor identity. */
  deps: unknown[]
}

const VIEWPORT_PAD = 8
// Clearance for the sticky header — placements above this line flip below.
const HEADER_CLEARANCE = 52
// Anchor lines this far outside the viewport hide the popover entirely.
const OFFSCREEN_SLACK = 24

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max))

/**
 * Measured, selection-centered placement for fixed-position floating chrome.
 *
 * Two-pass: the caller renders the popover (hidden via CSS until a position
 * exists), this hook measures the real box in a layout effect, then positions
 * before paint — first visible frame is already at its final spot, and
 * viewport clamping uses true dimensions instead of estimates.
 *
 * Returns `position: null` while unmeasured, inactive, or the anchor is
 * offscreen/gone. Attach `ref` to the popover root; gate visibility (and
 * `inert`) on `position` being non-null.
 */
export function useAnchoredPopover<T extends HTMLElement>({
  active,
  getView,
  getRange,
  preferBelow = false,
  freezeWhenLost = false,
  gap = 8,
  deps,
}: Options): { ref: RefObject<T | null>; position: AnchoredPosition | null } {
  const ref = useRef<T | null>(null)
  const lastGood = useRef<AnchoredPosition | null>(null)
  const [position, setPosition] = useState<AnchoredPosition | null>(null)

  const place = (next: AnchoredPosition | null) => {
    setPosition((prev) => {
      if (
        prev === next ||
        (prev &&
          next &&
          prev.x === next.x &&
          prev.y === next.y &&
          prev.detached === next.detached)
      ) {
        return prev
      }
      return next
    })
  }

  useLayoutEffect(() => {
    if (!active) {
      lastGood.current = null
      place(null)
      return
    }
    const view = getView()
    const el = ref.current
    if (!view || !el) {
      place(null)
      return
    }

    const range = getRange()
    if (!range) {
      // Anchor gone: stateful chrome freezes where it was; stateless hides.
      place(freezeWhenLost && lastGood.current ? { ...lastGood.current, detached: true } : null)
      return
    }

    let start: { left: number; top: number; bottom: number }
    let end: { left: number; top: number; bottom: number }
    try {
      start = view.coordsAtPos(range.from)
      end = view.coordsAtPos(range.to)
    } catch {
      // Editor mid-teardown or stale positions.
      place(null)
      return
    }

    // Hide while the placement anchor line is scrolled out of view.
    const anchorLine = preferBelow ? end : start
    if (
      anchorLine.top < -OFFSCREEN_SLACK ||
      anchorLine.top > window.innerHeight + OFFSCREEN_SLACK
    ) {
      place(null)
      return
    }

    const width = el.offsetWidth
    const height = el.offsetHeight

    // Center over the selection when it sits on one line; for multi-line
    // selections, center on the anchor line's endpoint instead.
    const sameLine = Math.abs(start.top - end.top) < 4
    const centerX = sameLine ? (start.left + end.left) / 2 : anchorLine.left
    const maxX = window.innerWidth - width - VIEWPORT_PAD
    const x = maxX < VIEWPORT_PAD ? VIEWPORT_PAD : clamp(centerX - width / 2, VIEWPORT_PAD, maxX)

    const above = start.top - height - gap
    const below = end.bottom + gap
    let y: number
    if (preferBelow) {
      y = below
      if (y + height > window.innerHeight - VIEWPORT_PAD) {
        // Flip above only when that clears the header AND the anchor;
        // otherwise clamp upward with a hard floor below the selection —
        // the popover never sits on top of the anchored text.
        y = above >= HEADER_CLEARANCE ? above : Math.max(window.innerHeight - height - VIEWPORT_PAD, below)
      }
    } else {
      y = above
      if (y < HEADER_CLEARANCE) y = below
      if (y + height > window.innerHeight - VIEWPORT_PAD && y === above) {
        y = Math.max(HEADER_CLEARANCE, window.innerHeight - height - VIEWPORT_PAD)
      }
    }

    const next = { x, y, detached: false }
    lastGood.current = next
    place(next)
    // Geometry is re-derived from the live view; deps carry the invalidation
    // signals (scroll/resize tick, doc changes, anchor identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps])

  return { ref, position }
}
