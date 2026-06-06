import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Slice, Fragment } from '@milkdown/kit/prose/model'
import { AddMarkStep } from '@milkdown/kit/prose/transform'
import type { Mark, MarkType, Node } from '@milkdown/kit/prose/model'
import { ySyncPluginKey } from 'y-prosemirror'
import { isSuggestChangesEnabled } from '@handlewithcare/prosemirror-suggest-changes'
import { provenanceIdentityCtx } from '../provenance/mark'
import { SKIP_PROVENANCE } from '../provenance/writer'

export const suggestGuardKey = new PluginKey('SUGGEST_GUARD')

const isRemote = (tr: Transaction): boolean => Boolean(tr.getMeta(ySyncPluginKey))

const SUGGESTION_MARKS = ['insertion', 'deletion', 'modification']

const stripFragment = (fragment: Fragment): Fragment => {
  const children: Node[] = []
  fragment.forEach((child) => {
    let node = child.mark(child.marks.filter((m) => !SUGGESTION_MARKS.includes(m.type.name)))
    if (node.content.childCount > 0) {
      node = node.copy(stripFragment(node.content))
    }
    children.push(node)
  })
  return Fragment.fromArray(children)
}

/**
 * Local-transaction guard for suggestion marks, registered AFTER
 * provenanceWriter (KTD 6 ordering — both observe the dispatch wrapper's
 * already-transformed transaction).
 *
 * Two jobs, both scoped to local non-remote transactions:
 *
 * 1. Suggesting ON — stamp attribution. The library's step transforms create
 *    insertion/deletion marks carrying only `{id}`; the `author` attr lands
 *    as the empty default. Re-apply those marks with the local identity so
 *    attribution syncs with the mark (same-type marks replace, so this is a
 *    safe overwrite — the same mechanic review-state advancement uses).
 *
 * 2. Suggesting OFF — strip inherited suggestion marks from locally typed
 *    text. An Edit-mode user typing inside someone's pending insertion must
 *    split it, not silently extend it (R11).
 *
 * Resolve commands and the provenance writer's own appends are skipped via
 * SKIP_PROVENANCE; remote and undo/redo transactions via the y-sync meta,
 * exactly like provenanceWriter.
 */
export const suggestGuard = $prose((ctx) => {
  return new Plugin({
    key: suggestGuardKey,
    props: {
      // Pasted content never carries suggestion marks in: stale ids from
      // copied pending text would alias foreign suggestions. In Suggest mode
      // the paste itself is then tracked as a fresh insertion by the
      // dispatch wrapper.
      transformPasted: (slice: Slice): Slice => {
        let dirty = false
        const scan = (node: Node): void => {
          if (node.marks.some((m) => SUGGESTION_MARKS.includes(m.type.name))) dirty = true
          node.forEach(scan)
        }
        slice.content.forEach(scan)
        if (!dirty) return slice
        return new Slice(stripFragment(slice.content), slice.openStart, slice.openEnd)
      },
    },
    appendTransaction: (transactions, _oldState, newState) => {
      const insertionType = newState.schema.marks.insertion as MarkType | undefined
      const deletionType = newState.schema.marks.deletion as MarkType | undefined
      if (!insertionType || !deletionType) return null

      const ranges: { from: number; to: number }[] = []
      for (const tr of transactions) {
        if (!tr.docChanged) continue
        if (isRemote(tr) || Boolean(tr.getMeta(SKIP_PROVENANCE))) continue
        tr.steps.forEach((step) => {
          const map = step.getMap()
          ranges.forEach((range) => {
            range.from = map.map(range.from, 1)
            range.to = map.map(range.to, -1)
          })
          // Deletion marks land via AddMarkStep on existing text — no doc
          // size change, so getMap() yields no ranges. Collect them
          // explicitly or deletions would never get author-stamped.
          if (step instanceof AddMarkStep && SUGGESTION_MARKS.includes(step.mark.type.name)) {
            ranges.push({ from: step.from, to: step.to })
          }
          map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            if (newEnd > newStart) ranges.push({ from: newStart, to: newEnd })
          })
        })
      }
      if (ranges.length === 0) return null

      const enabled = isSuggestChangesEnabled(newState)
      const me = ctx.get(provenanceIdentityCtx.key).name
      let tr = newState.tr
      let changed = false

      for (const { from, to } of ranges) {
        if (to <= from) continue
        newState.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isText) return
          const suggestionMark = node.marks.find(
            (m): m is Mark => m.type === insertionType || m.type === deletionType,
          )
          if (!suggestionMark) return

          const start = Math.max(pos, from)
          const end = Math.min(pos + node.nodeSize, to)

          if (!enabled) {
            tr = tr.removeMark(start, end, suggestionMark.type)
            changed = true
          } else if (!suggestionMark.attrs.author) {
            tr = tr.addMark(
              start,
              end,
              suggestionMark.type.create({ ...suggestionMark.attrs, author: me }),
            )
            changed = true
          }
        })
      }

      if (!changed) return null
      tr.setMeta(SKIP_PROVENANCE, true)
      tr.setMeta('addToHistory', false)
      return tr
    },
  })
})
