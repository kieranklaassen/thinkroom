import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const CARD_GAP = 10

export interface MarginStackEntry<K extends string | number> {
  key: K
  /** Desired top: the anchor's y in the shared scroll context. */
  top: number
}

/**
 * Google-Docs-style margin stacking: each card wants to sit at its anchor's
 * vertical position, pushed down past the previous card so the stack never
 * overlaps. Two-pass — cards render, `measure` supplies desired tops, and
 * final tops are assigned before paint.
 *
 * A card animates `top` only once "placed" — flagged a frame after its
 * first measured position paints — so neither initial layout nor a newly
 * arrived card slides in from 0.
 *
 * Window resizes and images loading into the copy reflow everything below
 * them, so a debounced remeasure rides along.
 */
export function useMarginStack<K extends string | number>(
  measure: () => MarginStackEntry<K>[] | null,
  deps: unknown[],
): {
  tops: Map<K, number>
  placed: Set<K>
  setCardRef: (key: K) => (el: HTMLElement | null) => void
} {
  const cardRefs = useRef(new Map<K, HTMLElement>())
  const [tops, setTops] = useState(new Map<K, number>())
  const [placed, setPlaced] = useState<Set<K>>(new Set())
  const [resizeTick, setResizeTick] = useState(0)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const remeasure = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setResizeTick((t) => t + 1), 150)
    }
    // load doesn't bubble; capture.
    const onLoad = (event: Event) => {
      if ((event.target as HTMLElement | null)?.tagName === 'IMG') remeasure()
    }
    window.addEventListener('resize', remeasure)
    document.addEventListener('load', onLoad, true)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('resize', remeasure)
      document.removeEventListener('load', onLoad, true)
    }
  }, [])

  useLayoutEffect(() => {
    const entries = measure()
    if (!entries) return

    entries.sort((a, b) => a.top - b.top)
    const next = new Map<K, number>()
    let prevBottom = -CARD_GAP
    for (const entry of entries) {
      const height = cardRefs.current.get(entry.key)?.offsetHeight ?? 0
      const top = Math.max(entry.top, prevBottom + CARD_GAP)
      next.set(entry.key, top)
      prevBottom = top + height
    }
    setTops((prev) => {
      if (prev.size === next.size && [...next].every(([key, top]) => prev.get(key) === top)) {
        return prev
      }
      return next
    })

    // Flag fresh cards as placed on the next frame (first top paints first);
    // forget keys that left so a returning card animates in fresh.
    const keys = new Set(entries.map((entry) => entry.key))
    const raf = requestAnimationFrame(() => {
      setPlaced((prev) => {
        const grown = new Set([...prev].filter((key) => keys.has(key)))
        keys.forEach((key) => grown.add(key))
        return grown.size === prev.size && [...grown].every((key) => prev.has(key))
          ? prev
          : grown
      })
    })
    return () => cancelAnimationFrame(raf)
    // `measure` reads live view geometry; deps carry the invalidation signals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, resizeTick])

  const setCardRef = useCallback(
    (key: K) => (el: HTMLElement | null) => {
      if (el) cardRefs.current.set(key, el)
      else cardRefs.current.delete(key)
    },
    [],
  )

  return { tops, placed, setCardRef }
}
