import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { router } from '@inertiajs/react'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorHandle } from '../../editor/milkdown_editor'
import { paragraphDigest, paragraphPayload, projectParagraphs } from '../../editor/paragraph_projection'
import type { WritingPackPayload, WritingPassPayload, WritingReviewerPayload } from '../../types/payloads'

interface Options {
  slug: string
  /** undefined: not loaded (optional prop outside Comment mode); null: no pass yet. */
  pass: WritingPassPayload | null | undefined
  /** The account's enabled lenses across its packs (server-derived). */
  reviewers: WritingReviewerPayload[]
  packs: WritingPackPayload[]
  /** True while the page is in Comment mode for a featured account. */
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
  /** Lens keys switched off across the account's packs (server state). */
  off: Set<string>
  /** Switch one lens on or off; persisted on the account's pack subscription. */
  toggleLens: (packId: number, key: string) => void
  /** Install (or refresh) a pack by `owner/repo[@ref]` and subscribe the account. */
  addPack: (locator: string) => void
  removePack: (packId: number) => void
  /** A pack request is in flight. */
  packBusy: boolean
  packError: string | null
  clearPackError: () => void
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
  /** Reload the pass prop (cable event or entering Comment mode). */
  reloadPass: () => void
}

const SELECTION_PROPS = ['writing_reviewers', 'writing_packs']

/**
 * Owns the reviewers panel's state: the account's packs and lens selection
 * (server-persisted through the writing_packs endpoints, so they follow the
 * account across browsers), the run request (paragraphs projected from the
 * live editor, lens keys, the viewer's name), and reloading the
 * `writing_pass` prop, which other modes never fetch.
 */
export function useWritingPass({ slug, pass, reviewers, packs, active, enabled, canWrite, handle, identityName, docTick }: Options): WritingPassControls {
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [packBusy, setPackBusy] = useState(false)
  const [packError, setPackError] = useState<string | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active

  const off = useMemo(() => {
    const keys = new Set<string>()
    for (const pack of packs) for (const lens of pack.lenses) if (!lens.enabled) keys.add(lens.key)
    return keys
  }, [packs])

  const selectionVisit = useCallback((request: () => void) => {
    setPackError(null)
    setPackBusy(true)
    request()
  }, [])
  const selectionOptions = useMemo(() => ({
    preserveState: true,
    preserveScroll: true,
    only: SELECTION_PROPS,
    async: true,
    onError: (errors: Record<string, unknown>) => {
      const message = errors.writing_pack
      setPackError(typeof message === 'string' ? message : 'That pack could not be changed.')
    },
    onHttpException: (response: { status: number; data: unknown }) => {
      const text = typeof response.data === 'string' ? response.data.trim() : ''
      setPackError(response.status === 429 && text.length > 0 && text.length < 240 ? text : 'That pack could not be changed.')
      return false
    },
    onFinish: () => setPackBusy(false),
  }), [])

  const toggleLens = useCallback((packId: number, key: string) => {
    const pack = packs.find((candidate) => candidate.id === packId)
    if (!pack) return
    const disabled = new Set(pack.lenses.filter((lens) => !lens.enabled).map((lens) => lens.key))
    if (disabled.has(key)) disabled.delete(key)
    else disabled.add(key)
    selectionVisit(() => router.patch(`/writing_packs/${packId}`, { disabled_lens_keys: [...disabled] }, selectionOptions))
  }, [packs, selectionVisit, selectionOptions])

  const addPack = useCallback((locator: string) => {
    const trimmed = locator.trim()
    if (!trimmed) {
      setPackError('Enter a marketplace as owner/repo, optionally @branch or @commit')
      return
    }
    selectionVisit(() => router.post('/writing_packs', { locator: trimmed }, selectionOptions))
  }, [selectionVisit, selectionOptions])

  const removePack = useCallback((packId: number) => {
    selectionVisit(() => router.delete(`/writing_packs/${packId}`, selectionOptions))
  }, [selectionVisit, selectionOptions])

  const activeKeys = useMemo(() => reviewers.map((reviewer) => reviewer.key), [reviewers])

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

  // A running pass broadcasts once per paragraph per lens; coalesce the
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

  // The prop is optional outside Comment mode; fetch it once on entry.
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
    toggleLens,
    addPack,
    removePack,
    packBusy,
    packError,
    clearPackError: () => setPackError(null),
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
