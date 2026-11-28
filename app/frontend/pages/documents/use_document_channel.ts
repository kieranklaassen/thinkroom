import { useCallback, useEffect, useState } from 'react'
import { router, type usePoll } from '@inertiajs/react'
import type { EditorHandle } from '../../editor/milkdown_editor'
import { useMetaChannel } from '../../lib/use_meta_channel'

interface Options {
  slug: string
  handle: EditorHandle | null
  yours: boolean
  connectionIdentity: string
  presencePoll: ReturnType<typeof usePoll>
  onTitle: (title: string) => void
  onWritingPass: () => void
}

interface DocumentChannel {
  newVersionAvailable: boolean
  onDocumentGone: () => void
  reloadChangedAccess: () => void
  reloadAfterContentReset: () => void
}

/** Answers what the server says about this document while it is open:
 *  deletion, replaced content, changed access, and a newer deployed build. */
export function useDocumentChannel({
  slug,
  handle,
  yours,
  connectionIdentity,
  presencePoll,
  onTitle,
  onWritingPass,
}: Options): DocumentChannel {
  const [newVersionAvailable, setNewVersionAvailable] = useState(false)

  // When the doc is deleted (live broadcast, or channel rejection after an
  // offline delete), leave the editor cleanly instead of 404ing in place.
  // Stop the presence poll first — Inertia's navigation is async, and a poll
  // firing in that window would partial-reload the destroyed slug into a 404.
  const onDocumentGone = useCallback(() => {
    presencePoll.stop()
    router.visit('/')
  }, [presencePoll])
  const reloadEditingAccess = useCallback(() => {
    router.reload({
      only: yours ? ['ownership'] : ['document', 'ownership'],
      async: true,
    })
  }, [yours])
  const reloadChangedAccess = useCallback(() => {
    router.reload({ only: ['document', 'ownership', 'viewer'], async: true })
  }, [])
  const reloadAfterContentReset = useCallback(() => {
    presencePoll.stop()
    window.location.reload()
  }, [presencePoll])
  useMetaChannel(slug, {
    onDeleted: onDocumentGone,
    onTitle,
    onVersionAvailable: () => setNewVersionAvailable(true),
    onEditingLock: reloadEditingAccess,
    onContentReset: reloadAfterContentReset,
    onWritingPass,
    connectionIdentity,
  })

  useEffect(() => {
    if (!handle) return
    const provider = handle.provider
    provider.on('write-denied', reloadChangedAccess)
    return () => {
      provider.off('write-denied', reloadChangedAccess)
    }
  }, [handle, reloadChangedAccess])

  return { newVersionAvailable, onDocumentGone, reloadChangedAccess, reloadAfterContentReset }
}
