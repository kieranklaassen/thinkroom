import { useCallback, useRef } from 'react'
import { router } from '@inertiajs/react'
import { getSession } from '../../editor/collab_session'

interface AccessProps {
  document: unknown
  ownership: unknown
  viewer: { account: { id: number } | null }
}

export const viewerIdentity = (viewer: AccessProps['viewer']): string =>
  viewer.account ? `account:${viewer.account.id}` : 'guest'

// The load that follows renders the new identity, so being sent to the same
// one again means that load did not bring it. Without storage to tell, no load.
function firstLoadFor(slug: string, identity: string): boolean {
  const key = `pruf:identity-load:${slug}`
  try {
    if (sessionStorage.getItem(key) === identity) return false
    sessionStorage.setItem(key, identity)
    return true
  } catch {
    return false
  }
}

/**
 * Re-reads the access of a page whose document may still wait for its first
 * content. When the answer is for another identity and the page still waits,
 * the whole page loads again, so its requests, socket and editor all belong to
 * that identity; there is no text to lose. Otherwise the answer is applied.
 */
export function useWaitingAccess(slug: string, shown: AccessProps): () => void {
  const shownRef = useRef(shown)
  shownRef.current = shown
  return useCallback(() => {
    router.reload({
      only: ['document', 'ownership', 'viewer'],
      async: true,
      // A page that waits keeps waiting; it has no use for the error dialog.
      onHttpException: () => false,
      onBeforeUpdate: (page) => {
        const provider = getSession(slug)?.provider
        const from = viewerIdentity(shownRef.current.viewer)
        const to = viewerIdentity((page.props as unknown as AccessProps).viewer)
        if (from === to || !provider?.awaitingContent || !firstLoadFor(slug, to)) return
        // Applying the answer would open a session that could take the seed
        // claim just before this page goes away.
        Object.assign(page.props, shownRef.current)
        provider.discardWait()
        window.location.reload()
      },
    })
  }, [slug])
}
