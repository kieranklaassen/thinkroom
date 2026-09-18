import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { router } from '@inertiajs/react'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorHandle } from '../../editor/milkdown_editor'
import { paragraphPayload, projectParagraphs } from '../../editor/paragraph_projection'
import { setCookie } from '../../lib/cookies'
import type { WritingPassPayload, WritingReviewerPayload } from '../../types/payloads'

interface Options {
  slug: string
  /** undefined: not loaded (optional prop outside compound mode); null: no pass yet. */
  pass: WritingPassPayload | null | undefined
  reviewers: WritingReviewerPayload[]
  /** Reviewer keys switched off, from the server-validated cookie. */
  initialOff: string[]
  /** True while the page is in compound mode. */
  active: boolean
  /** Server has a judge configured (TypeSafe key or the fake). */
  enabled: boolean
  canWrite: boolean
  handle: EditorHandle | null
  identityName: string
}

export interface WritingPassControls {
  off: Set<string>
  toggleReviewer: (key: string) => void
  /** Keys that run on the next pass, registry order. */
  activeKeys: string[]
  run: () => void
  /** A run request is in flight, or the pass is still being judged. */
  busy: boolean
  canRun: boolean
  error: string | null
  clearError: () => void
  /** Reload the pass prop (cable event or entering compound mode). */
  reloadPass: () => void
}

const OFF_COOKIE = 'pruf_cw_off'

/**
 * Owns the compound panel's state: which reviewers are on (cookie-backed so
 * the server can render the same toggles on first paint), the run request
 * (paragraphs projected from the live editor, reviewers, the viewer's name),
 * and reloading the `writing_pass` prop, which other modes never fetch.
 */
export function useWritingPass({ slug, pass, reviewers, initialOff, active, enabled, canWrite, handle, identityName }: Options): WritingPassControls {
  const [off, setOff] = useState(() => new Set(initialOff))
  const [error, setError] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const activeRef = useRef(active)
  activeRef.current = active

  const toggleReviewer = useCallback((key: string) => {
    setOff((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      setCookie(OFF_COOKIE, [...next].join(','))
      return next
    })
  }, [])

  const activeKeys = useMemo(() => reviewers.filter((reviewer) => !off.has(reviewer.key)).map((reviewer) => reviewer.key), [reviewers, off])

  const reloadPass = useCallback(() => {
    if (!activeRef.current) return
    // async: a background reload must never cancel an in-flight run request.
    router.reload({ only: ['writing_pass'], async: true })
  }, [])

  // The prop is optional outside compound mode; fetch it once on entry.
  useEffect(() => {
    if (active && pass === undefined) reloadPass()
  }, [active, pass, reloadPass])

  const run = useCallback(() => {
    if (!handle || requesting) return
    let paragraphs: ReturnType<typeof paragraphPayload> = []
    try {
      handle.editor.action((ctx) => {
        paragraphs = paragraphPayload(projectParagraphs(ctx.get(editorViewCtx).state.doc))
      })
    } catch {
      return // editor torn down mid-navigation
    }
    if (paragraphs.length === 0) {
      setError('There is no prose to review yet.')
      return
    }
    if (activeKeys.length === 0) {
      setError('Switch on at least one reviewer.')
      return
    }
    setError(null)
    setRequesting(true)
    router.post(`/d/${encodeURIComponent(slug)}/writing_passes`, {
      reviewers: activeKeys,
      paragraphs,
      requested_by_name: identityName,
    }, {
      preserveState: true,
      preserveScroll: true,
      only: ['writing_pass', 'activities'],
      async: true,
      onError: (errors) => setError(typeof errors.writing_pass === 'string' ? errors.writing_pass : 'The reviewers could not start.'),
      onFinish: () => setRequesting(false),
    })
  }, [handle, requesting, activeKeys, slug, identityName])

  const judging = pass?.status === 'queued' || pass?.status === 'running'

  return {
    off,
    toggleReviewer,
    activeKeys,
    run,
    busy: requesting || Boolean(judging),
    canRun: enabled && canWrite && Boolean(handle) && !requesting,
    error,
    clearError: () => setError(null),
    reloadPass,
  }
}
