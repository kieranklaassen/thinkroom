import { useCallback, useMemo } from 'react'
import { router } from '@inertiajs/react'
import type { CompoundPanelProps } from '../../components/compound_panel'
import type { FindingCardsSource } from '../../components/finding_margin_cards'
import type { EditorHandle } from '../../editor/milkdown_editor'
import type {
  WritingFindingPayload,
  WritingPackPayload,
  WritingPassPayload,
  WritingReviewerPayload,
} from '../../types/payloads'
import { useFindingAnchors } from './use_finding_anchors'
import { useWritingPass } from './use_writing_pass'

interface Options {
  slug: string
  /** undefined: not loaded (optional prop outside Comment mode); null: no pass yet. */
  pass: WritingPassPayload | null | undefined
  reviewers: WritingReviewerPayload[]
  packs: WritingPackPayload[]
  /** True while the page is in Comment mode for a featured account. */
  active: boolean
  enabled: boolean
  canWrite: boolean
  handle: EditorHandle | null
  identityName: string
  docTick: number
}

export interface CompoundReview {
  /** Reload the pass prop (cable event). */
  reloadPass: () => void
  /** Findings whose lens is switched on; the dock's badge. */
  visibleFindingCount: number
  /** Margin cards, without the compact layout's marker tap. */
  findingCards: Omit<FindingCardsSource, 'onMarkerSelect'>
  /** One prop bag for the desktop rail and the compact sheet. */
  panelProps: CompoundPanelProps
}

/**
 * Compound writing: the account's packs and lens selection, the run
 * request, and the pass prop (fetched only in Comment mode); findings
 * anchor back into the live doc and paint through the Custom Highlight API
 * while Comment mode is active for a featured account.
 */
export function useCompoundReview({
  slug,
  pass,
  reviewers,
  packs,
  active,
  enabled,
  canWrite,
  handle,
  identityName,
  docTick,
}: Options): CompoundReview {
  const writing = useWritingPass({
    slug,
    pass,
    reviewers,
    packs,
    active,
    enabled,
    canWrite,
    handle,
    identityName,
    docTick,
  })
  const visibleKeys = useMemo(
    () => new Set(reviewers.filter((reviewer) => !writing.off.has(reviewer.key)).map((reviewer) => reviewer.key)),
    [reviewers, writing.off],
  )
  const findings = useMemo(() => pass?.findings ?? [], [pass])
  // Findings name the lens they were judged with; the pass snapshot is the
  // source of its name and colour even after the pack changes.
  const lenses = useMemo(() => {
    const map = new Map<string, WritingReviewerPayload>()
    for (const lens of reviewers) map.set(lens.key, lens)
    for (const lens of pass?.lenses ?? []) map.set(lens.key, lens)
    return map
  }, [reviewers, pass])
  const colorSlots = useMemo(() => new Map([...lenses].map(([key, lens]) => [key, lens.color])), [lenses])
  const { anchoredIds, changedIds, paragraphs, jumpToFinding, hoverFinding } = useFindingAnchors({
    findings,
    handle,
    docTick,
    visibleKeys,
    colorSlots,
    active,
  })
  const visibleFindingCount = useMemo(
    () => findings.filter((finding) => visibleKeys.has(finding.reviewer_key)).length,
    [findings, visibleKeys],
  )
  const dismissFinding = useCallback((finding: WritingFindingPayload) => {
    router.patch(`/writing_findings/${finding.id}/dismiss`, {}, {
      preserveState: true,
      preserveScroll: true,
      only: ['writing_pass'],
      async: true,
    })
  }, [])

  // Finding cards join the comment and suggestion stack in the margin. The
  // object identity is a remeasure signal for that stack, so it changes only
  // when the anchored paragraphs, the lens snapshot, or the handlers do.
  const findingCards = useMemo(() => ({
    paragraphs,
    lenses,
    canWrite,
    onJumpTo: jumpToFinding,
    onHover: hoverFinding,
    onDismiss: dismissFinding,
  }), [paragraphs, lenses, canWrite, jumpToFinding, hoverFinding, dismissFinding])

  return {
    reloadPass: writing.reloadPass,
    visibleFindingCount,
    findingCards,
    panelProps: {
      reviewers,
      packs,
      pass,
      enabled,
      canWrite,
      onToggleLens: writing.toggleLens,
      onAddPack: writing.addPack,
      onRemovePack: writing.removePack,
      packBusy: writing.packBusy,
      packError: writing.packError,
      onDismissPackError: writing.clearPackError,
      onRun: writing.run,
      canRun: writing.canRun,
      requesting: writing.requesting,
      textChanged: writing.textChanged,
      error: writing.error,
      notice: writing.notice,
      onDismissError: writing.clearError,
      anchoredIds,
      changedIds,
      onJumpTo: jumpToFinding,
      onHover: hoverFinding,
      onDismiss: dismissFinding,
    },
  }
}
