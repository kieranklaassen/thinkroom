import { useCallback, useRef, useState } from 'react'
import { router } from '@inertiajs/react'
import { LIST_PROPS, type DocLink } from './document_lists'

/** Deleting, archiving and restoring a page, and the Archived list. */
export function useDocumentActions() {
  // Delete (row menu, Archived list, native swipe). The server re-checks
  // ownership; this is just the affordance. WKWebView shows confirm() as a
  // native alert.
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Bumped on failure so every SwipeRow snaps closed (per R6, the error
  // message shouldn't sit next to a still-armed Delete).
  const [swipeCloseSignal, setSwipeCloseSignal] = useState(0)
  const deleteDocument = useCallback((slug: string) => {
    if (!window.confirm('Delete this document? This can’t be undone.')) return
    setDeleteError(null)
    router.delete(`/d/${slug}`, {
      preserveScroll: true,
      onStart: () => setDeletingSlug(slug),
      onFinish: () => setDeletingSlug(null),
      onSuccess: () => {
        if (showArchivedRef.current) router.reload({ only: ['archived', 'archived_count'] })
      },
      onError: (errors) => {
        const message = typeof errors.document === 'string' ? errors.document : null
        setDeleteError(message ?? 'Delete failed — please try again')
        setSwipeCloseSignal((signal) => signal + 1)
      },
    })
  }, [])

  // Archive puts a page away without deleting it: it leaves Contents and
  // Pinned and is listed under Archived. A notice offers one-click undo.
  const [showArchived, setShowArchived] = useState(false)
  const showArchivedRef = useRef(false)
  showArchivedRef.current = showArchived
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null)
  const setArchived = useCallback((document: DocLink, archive: boolean) => {
    setDeleteError(null)
    router.patch(
      `/d/${document.slug}/archive`,
      { archived: archive },
      {
        preserveScroll: true,
        only: showArchivedRef.current ? [...LIST_PROPS, 'archived'] : LIST_PROPS,
        onSuccess: () =>
          setNotice(
            archive
              ? { text: `Archived “${document.title}”.`, undo: () => setArchived(document, false) }
              : { text: `Restored “${document.title}”.` },
          ),
        onError: (errors) => {
          const message = typeof errors.archive === 'string' ? errors.archive : null
          setDeleteError(message ?? 'Archive failed — please try again')
        },
      },
    )
  }, [])
  const toggleArchived = () => {
    const next = !showArchived
    setShowArchived(next)
    if (next) router.reload({ only: ['archived'] })
  }

  return {
    deletingSlug,
    deleteError,
    swipeCloseSignal,
    deleteDocument,
    showArchived,
    toggleArchived,
    notice,
    setNotice,
    setArchived,
  }
}
