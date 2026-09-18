import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { router } from '@inertiajs/react'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorHandle } from '../../editor/milkdown_editor'
import { paragraphDigest, paragraphPayload, projectParagraphs } from '../../editor/paragraph_projection'
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
  /** Re-fingerprints the live text on local and remote document changes. */
  docTick: number
}

export interface WritingPassControls {
  off: Set<string>
  toggleReviewer: (key: string) => void
  run: () => void
  /** The run request is in flight. A pass still being judged does not block
   *  a new run: the new pass replaces it, which is also the recovery path for
   *  a pass a restart left behind. */
  requesting: boolean
  canRun: boolean
  error: string | null
  /** The server declined to spend because nothing changed; findings stand. */
  notice: string | null
  clearError: () => void
  /** The live paragraphs no longer match the ones the pass judged. */
  textChanged: boolean
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
export function useWritingPass({ slug, pass, reviewers, initialOff, active, enabled, canWrite, handle, identityName, docTick }: Options): WritingPassControls {
  const [off, setOff] = useState(() => new Set(initialOff))
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const activeRef = useRef(active)
  activeRef.current = active

  const toggleReviewer = useCallback((key: string) => {
    const next = new Set(off)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setOff(next)
    setCookie(OFF_COOKIE, [...next].join(','))
  }, [off])

  const activeKeys = useMemo(() => reviewers.filter((reviewer) => !off.has(reviewer.key)).map((reviewer) => reviewer.key), [reviewers, off])

  const projected = useCallback(() => {
    if (!handle) return null
    try {
      return handle.editor.action((ctx) => projectParagraphs(ctx.get(editorViewCtx).state.doc))
    } catch {
      return null // editor torn down mid-navigation
    }
  }, [handle])

  const textChanged = useMemo(() => {
    void docTick
    if (!active || !pass) return false
    const paragraphs = projected()
    return paragraphs !== null && paragraphDigest(paragraphs.map((paragraph) => paragraph.text)) !== pass.paragraphs_digest
  }, [active, pass, projected, docTick])

  // A running pass broadcasts once per paragraph per reviewer; coalesce the
  // burst into one reload per window, like useMetaChannel does for its props.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reloadPass = useCallback(() => {
    if (!activeRef.current) return
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null
      if (!activeRef.current) return
      // async: a background reload must never cancel an in-flight run request.
      router.reload({ only: ['writing_pass'], async: true })
    }, 150)
  }, [])
  useEffect(() => () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
  }, [])

  // The prop is optional outside compound mode; fetch it once on entry.
  useEffect(() => {
    if (active && pass === undefined) reloadPass()
  }, [active, pass, reloadPass])

  const run = useCallback(() => {
    if (requesting) return
    const projection = projected()
    if (!projection) return
    const paragraphs = paragraphPayload(projection)
    if (paragraphs.length === 0) {
      setError('There is no prose to review yet.')
      return
    }
    if (activeKeys.length === 0) {
      setError('Switch on at least one reviewer.')
      return
    }
    setError(null)
    setNotice(null)
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
      onError: (errors) => {
        if (typeof errors.writing_pass_notice === 'string') {
          setNotice(errors.writing_pass_notice)
          return
        }
        const message = errors.writing_pass ?? errors.document
        setError(typeof message === 'string' ? message : 'The reviewers could not start.')
      },
      // A plain-text response (a 429 from the daily caps or the write rate
      // limit) would otherwise open Inertia's raw error modal over the editor;
      // the server's short message is the one to show.
      onHttpException: (response) => {
        const text = typeof response.data === 'string' ? response.data.trim() : ''
        setError(response.status === 429 && text.length > 0 && text.length < 240 ? text : 'The reviewers could not start.')
        return false
      },
      onFinish: () => setRequesting(false),
    })
  }, [requesting, projected, activeKeys, slug, identityName])

  return {
    off,
    toggleReviewer,
    run,
    requesting,
    canRun: enabled && canWrite && Boolean(handle) && !requesting,
    error,
    notice,
    clearError: () => {
      setError(null)
      setNotice(null)
    },
    textChanged,
    reloadPass,
  }
}
