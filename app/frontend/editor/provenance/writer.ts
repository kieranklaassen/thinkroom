import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import type { MarkType } from '@milkdown/kit/prose/model'
import { ySyncPluginKey } from 'y-prosemirror'
import { provenanceIdentityCtx } from './mark'

export const provenanceWriterKey = new PluginKey('PROVENANCE_WRITER')

/**
 * Transactions that already attribute their content explicitly (accepting an
 * AI suggestion, advancing a review state) set this meta to opt out.
 */
export const SKIP_PROVENANCE = 'skipProvenance'

const isRemote = (tr: Transaction): boolean => Boolean(tr.getMeta(ySyncPluginKey))
const isPasteLike = (tr: Transaction): boolean => {
  const uiEvent = tr.getMeta('uiEvent') as string | undefined
  return uiEvent === 'paste' || uiEvent === 'drop'
}

/**
 * Attributes newly inserted text to the local human author.
 *
 * - Remote (y-sync) transactions are untouched — they carry their own marks.
 * - Paste/drop keeps existing provenance (copying AI text must not launder it
 *   into human text); only unmarked content gets the local human mark.
 * - Typed input overrides inherited non-human marks: typing inside or at the
 *   edge of an AI span produces human-attributed characters.
 */
export const provenanceWriter = $prose((ctx) => {
  return new Plugin({
    key: provenanceWriterKey,
    appendTransaction: (transactions, _oldState, newState) => {
      const markType = newState.schema.marks.provenance as MarkType | undefined
      if (!markType) return null

      const ranges: { from: number; to: number; preserveMarked: boolean }[] = []

      for (const tr of transactions) {
        if (!tr.docChanged) continue
        const skip = isRemote(tr) || Boolean(tr.getMeta(SKIP_PROVENANCE))
        const preserveMarked = isPasteLike(tr)

        tr.steps.forEach((step) => {
          const map = step.getMap()
          // Keep previously collected ranges valid through this step.
          ranges.forEach((range) => {
            range.from = map.map(range.from, 1)
            range.to = map.map(range.to, -1)
          })
          if (skip) return
          map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            if (newEnd > newStart) ranges.push({ from: newStart, to: newEnd, preserveMarked })
          })
        })
      }

      if (ranges.length === 0) return null

      const me = ctx.get(provenanceIdentityCtx.key).name
      let tr = newState.tr
      let changed = false

      for (const { from, to, preserveMarked } of ranges) {
        if (to <= from) continue
        newState.doc.nodesBetween(from, to, (node, pos, parent) => {
          if (!node.isText) return
          if (parent && !parent.type.allowsMarkType(markType)) return

          const existing = markType.isInSet(node.marks)
          if (existing) {
            const isLocalHuman =
              existing.attrs.kind === 'human' && existing.attrs.author === me
            if (isLocalHuman || preserveMarked) return
          }

          const start = Math.max(pos, from)
          const end = Math.min(pos + node.nodeSize, to)
          tr = tr.addMark(
            start,
            end,
            markType.create({ kind: 'human', author: me, state: 'verbatim' }),
          )
          changed = true
        })
      }

      if (!changed) return null
      tr.setMeta(SKIP_PROVENANCE, true)
      tr.setMeta('addToHistory', false)
      return tr
    },
  })
})
