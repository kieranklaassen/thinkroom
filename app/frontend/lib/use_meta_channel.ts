import { useEffect, useRef } from 'react'
import { router } from '@inertiajs/react'
import { getConsumer } from './cable'

interface MetaChannelOptions {
  /**
   * Fired when the document is deleted (the `document_deleted` broadcast).
   * This event bypasses the debounced reload entirely — partial-reloading a
   * destroyed doc would 404 — and any pending reload is cancelled first.
   */
  onDeleted?: () => void
  /** Receives the canonical H1-derived title without reloading Yjs props. */
  onTitle?: (title: string) => void
  /** Fired when this live tab reconnects to a different deployed build. */
  onVersionAvailable?: (version: string) => void
  /** Fired when the owner changes document write access. */
  onEditingLock?: (locked: boolean) => void
  /** Fired when an owner replaces the document source outside the live editor. */
  onContentReset?: () => void
  /** Recreate the shared socket when guest/account authentication changes. */
  connectionIdentity?: string
}

/**
 * Subscribes to DocumentMetaChannel and answers events with a debounced
 * partial Inertia reload — cable signals, controller stays the source of
 * truth. Events landing within the window batch into ONE reload (a single
 * action often broadcasts several, e.g. suggestions + activities), so the
 * server sees one request instead of a concurrent burst.
 *
 * `document_deleted` is special-cased: it clears the pending batch, cancels
 * the armed timer, and invokes `onDeleted` instead of reloading. A client
 * that was offline during the delete gets the same treatment on reconnect:
 * the channel rejects the resubscription (no document → `reject`), and the
 * `rejected` callback routes through `onDeleted` too.
 */
export function useMetaChannel(slug: string, options?: MetaChannelOptions): void {
  const onDeletedRef = useRef(options?.onDeleted)
  onDeletedRef.current = options?.onDeleted
  const onTitleRef = useRef(options?.onTitle)
  onTitleRef.current = options?.onTitle
  const onVersionAvailableRef = useRef(options?.onVersionAvailable)
  onVersionAvailableRef.current = options?.onVersionAvailable
  const onEditingLockRef = useRef(options?.onEditingLock)
  onEditingLockRef.current = options?.onEditingLock
  const onContentResetRef = useRef(options?.onContentReset)
  onContentResetRef.current = options?.onContentReset
  const loadedVersionRef = useRef<string | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let dead = false
    const pending = new Set<string>()

    const handleGone = () => {
      dead = true
      pending.clear()
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      onDeletedRef.current?.()
    }

    const subscription = getConsumer(options?.connectionIdentity).subscriptions.create(
      { channel: 'DocumentMetaChannel', slug },
      {
        received: ({
          event,
          title,
          version,
          locked,
        }: {
          event: string
          title?: string
          version?: string
          locked?: boolean
        }) => {
          if (dead) return
          if (event === 'document_deleted') {
            handleGone()
            return
          }
          if (event === 'title' && title) {
            onTitleRef.current?.(title)
            return
          }
          if (event === 'version') {
            if (!version) return
            if (loadedVersionRef.current === null) {
              loadedVersionRef.current = version
            } else if (loadedVersionRef.current !== version) {
              onVersionAvailableRef.current?.(version)
            }
            return
          }
          if (event === 'editing_lock' && typeof locked === 'boolean') {
            onEditingLockRef.current?.(locked)
            return
          }
          if (event === 'content_reset') {
            onContentResetRef.current?.()
            return
          }
          pending.add(event)
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            const only = [...pending]
            pending.clear()
            // async: a background reload must never cancel (and roll back)
            // an in-flight optimistic mutation like accepting a suggestion.
            router.reload({ only, async: true })
          }, 150)
        },
        rejected: () => {
          // The channel rejects when the document no longer exists —
          // reached by clients reconnecting after an offline delete.
          handleGone()
        },
      },
    )

    return () => {
      subscription.unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [slug, options?.connectionIdentity])
}
