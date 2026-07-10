import { useCallback, useEffect, useState } from 'react'
import {
  persistGuestIdentity,
  reconcileGuestCookie,
  serverIdentity,
  serverKnewGuest,
  storedGuestIdentity,
  userIdentity,
  type UserIdentity,
} from '../../editor/identity'
import type { ViewerPayload } from '../../types/viewer'

/**
 * The viewer's display identity for the document page.
 *
 * Initializer-only state plus an explicit rename handler — NOT a
 * sync-on-prop-change effect, which a future reload batch listing
 * `viewer` would silently clobber mid-rename.
 *
 * Hydration-safe init: server and the first client render BOTH derive
 * identity from the viewer prop alone — the chosen session name, else the
 * guest name + color the server read from the `pruf_guest` cookie, else
 * Anonymous. No localStorage read during render, so the markup is
 * byte-identical (zero hydration mismatch).
 *
 * When the cookie was present (the common returning-user case) the server
 * already rendered the real guest identity → NOTHING changes post-hydration.
 * Only when the cookie was absent (first-ever load, or a user whose identity
 * predates the cookie) does the post-hydration effect reconcile from
 * localStorage and write the cookie so the NEXT load is server-correct.
 */
export function useDocumentIdentity(viewer: ViewerPayload): {
  identity: UserIdentity
  guest: boolean
  handleRenamed: (name: string | null) => void
} {
  const [identity, setIdentity] = useState<UserIdentity>(() =>
    serverIdentity(viewer.name, viewer),
  )
  const [guest, setGuest] = useState(viewer.guest)

  useEffect(() => {
    // A chosen session name always wins and is server-known — never overridden
    // by the guest identity.
    if (viewer.name) return
    if (serverKnewGuest(viewer)) {
      // Server already rendered the cookie-backed guest identity. Re-seed
      // localStorage from it when storage is empty (cookie present but storage
      // cleared) so the cookie stays authoritative — never regenerate a fresh
      // identity here, which would silently rename the user on the next load.
      // Do NOT change React state: that would be the post-hydration flip we
      // just worked to avoid.
      if (!storedGuestIdentity()) persistGuestIdentity(identity)
      return
    }
    // Cookie absent: reconcile from localStorage (one-time migration) and write
    // the cookie. If there's no stored identity yet, generate + persist one.
    const stored = storedGuestIdentity()
    setIdentity(stored ?? reconcileGuestCookie())
    if (stored) persistGuestIdentity(stored)
    // viewer is stable for the life of the page; the rename handler owns
    // subsequent identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Rename applies here AFTER the server confirms the session write (the
  // chip's POST onSuccess). The handler only moves React state — the live
  // side effects ride the identity effect in the page, so a rename that
  // completes while the editor is still connecting (handle null) heals the
  // moment the handle arrives, and an in-flight POST can never act through
  // a stale null-handle closure.
  const handleRenamed = useCallback((name: string | null) => {
    setIdentity(userIdentity(name))
    setGuest(name === null)
  }, [])

  return { identity, guest, handleRenamed }
}
