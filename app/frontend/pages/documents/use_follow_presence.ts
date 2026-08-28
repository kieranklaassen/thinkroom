import { useCallback, useEffect, useState } from 'react'
import type { EditorHandle } from '../../editor/milkdown_editor'
import type { UserIdentity } from '../../editor/identity'
import { bindViewportBroadcast, bindViewportFollow } from '../../editor/viewport_follow'
import type { HumanPresence } from '../../components/presence_bar'

/**
 * Human presence and follow-the-collaborator viewport tracking: peers from
 * Yjs awareness, own-viewport broadcast, and the follow binding with its
 * release gestures (scroll, tap outside the presence bar, navigation keys).
 */
export function useFollowPresence(handle: EditorHandle | null): {
  peers: HumanPresence[]
  followingClientId: number | null
  toggleFollow: (clientId: number) => void
} {
  const [peers, setPeers] = useState<HumanPresence[]>([])
  const [followingClientId, setFollowingClientId] = useState<number | null>(null)

  useEffect(() => {
    if (!handle) return

    return bindViewportBroadcast(handle.editor, handle.provider.awareness)
  }, [handle])

  useEffect(() => {
    if (!handle || followingClientId === null) return
    const targetId = followingClientId

    return bindViewportFollow(
      handle.editor,
      handle.provider.awareness,
      targetId,
      () => setFollowingClientId((current) => current === targetId ? null : current),
    )
  }, [followingClientId, handle])

  useEffect(() => {
    if (followingClientId === null) return
    const release = () => setFollowingClientId(null)
    const releaseOutsidePresence = (event: PointerEvent | TouchEvent) => {
      const target = event.target as Element | null
      if (target?.closest('.presence-avatar--human')) return
      release()
    }
    const releaseOnNavigationKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
        release()
      }
    }

    window.addEventListener('wheel', release, { passive: true })
    window.addEventListener('touchstart', releaseOutsidePresence, { passive: true })
    window.addEventListener('pointerdown', releaseOutsidePresence, { passive: true })
    window.addEventListener('keydown', releaseOnNavigationKey)
    return () => {
      window.removeEventListener('wheel', release)
      window.removeEventListener('touchstart', releaseOutsidePresence)
      window.removeEventListener('pointerdown', releaseOutsidePresence)
      window.removeEventListener('keydown', releaseOnNavigationKey)
    }
  }, [followingClientId])

  // Human presence from Yjs awareness. Self is filtered out — the
  // IdentityChip represents you; a duplicate avatar next to it is noise.
  useEffect(() => {
    if (!handle) return
    const { awareness } = handle.provider
    const selfId = handle.provider.doc.clientID
    const update = () => {
      const states = Array.from(awareness.getStates().entries())
      const nextPeers = states
        .filter(([clientId]) => clientId !== selfId)
        .map(([clientId, state]) => {
          const user = (state as { user?: UserIdentity }).user
          return user ? { ...user, clientId } : null
        })
        .filter((user): user is HumanPresence => Boolean(user))
      setPeers((current) =>
        current.length === nextPeers.length && current.every((peer, index) => {
          const next = nextPeers[index]
          return next &&
            peer.clientId === next.clientId &&
            peer.name === next.name &&
            peer.color === next.color
        })
          ? current
          : nextPeers,
      )
    }
    update()
    awareness.on('change', update)
    return () => awareness.off('change', update)
  }, [handle])

  useEffect(() => {
    if (
      followingClientId !== null &&
      !peers.some((peer) => peer.clientId === followingClientId)
    ) {
      setFollowingClientId(null)
    }
  }, [followingClientId, peers])

  const toggleFollow = useCallback((clientId: number) => {
    setFollowingClientId((current) => (current === clientId ? null : clientId))
  }, [])

  return { peers, followingClientId, toggleFollow }
}
