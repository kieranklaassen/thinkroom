import { useEffect, useRef, useState } from 'react'
import { usePin, type PinnableDocument } from '../../lib/use_pin'
import { LIST_PROPS, type PinnedDoc } from './document_lists'

/** The page's pins: every star reads from `pinned`. Announces each change, and
 *  keeps keyboard focus in the Pinned section after an unpin there. */
export function usePinnedList(pinned: PinnedDoc[]) {
  const { toggle: togglePin, pending: pendingPins, error: pinError } = usePin(LIST_PROPS)
  const pinnedSlugs = new Set(pinned.map((document) => document.slug))
  const [announcement, setAnnouncement] = useState('')
  const pinnedHeadingRef = useRef<HTMLHeadingElement>(null)
  const pinnedStarRefs = useRef(new Map<string, HTMLButtonElement>())
  const [focusAfterUnpin, setFocusAfterUnpin] = useState<string | null>(null)
  useEffect(() => {
    if (focusAfterUnpin === null) return
    const target =
      focusAfterUnpin === '' ? pinnedHeadingRef.current : pinnedStarRefs.current.get(focusAfterUnpin)
    target?.focus({ preventScroll: true })
    setFocusAfterUnpin(null)
  }, [focusAfterUnpin, pinned])

  const setPin = (document: PinnableDocument, isPinned: boolean) => {
    if (togglePin(document, isPinned)) {
      setAnnouncement(`${isPinned ? 'Unpinned' : 'Pinned'} ${document.title}`)
    }
  }
  const unpinFromPinned = (document: PinnedDoc, index: number) => {
    const next = pinned[index + 1] ?? pinned[index - 1]
    if (togglePin(document, true)) {
      setAnnouncement(`Unpinned ${document.title}`)
      setFocusAfterUnpin(next ? next.slug : '')
    }
  }

  return {
    pinnedSlugs,
    pendingPins,
    pinError,
    announcement,
    pinnedHeadingRef,
    pinnedStarRefs,
    setPin,
    unpinFromPinned,
  }
}
