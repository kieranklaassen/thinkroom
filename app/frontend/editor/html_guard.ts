import { $ctx, $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Fragment, type Node } from '@milkdown/kit/prose/model'
import { AddMarkStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep } from '@milkdown/kit/prose/transform'
import { ySyncPluginKey } from 'y-prosemirror'
import * as Y from 'yjs'

export interface DocumentNotice {
  text: string
  offerSignIn?: boolean
}

export const HTML_ACCOUNT_NOTICE = 'Adding HTML needs an account'
export const HTML_KEPT_AS_TEXT_NOTICE: DocumentNotice = {
  text: `${HTML_ACCOUNT_NOTICE}, so it was kept as text.`,
  offerSignIn: true,
}
export const HTML_NOT_SAVED_NOTICE: DocumentNotice = {
  text: `${HTML_ACCOUNT_NOTICE}. Changes since then are not saved; copy them before you leave this page.`,
  offerSignIn: true,
}
export const HTML_SNAPSHOT_NOTICE: DocumentNotice = {
  text: `${HTML_ACCOUNT_NOTICE}, so the saved copy of this document was not updated.`,
  offerSignIn: true,
}

export const htmlGuardCtx = $ctx<
  { needsAccount: () => boolean; onKeptAsText: (() => void) | null },
  'htmlGuard'
>({ needsAccount: () => false, onKeptAsText: null }, 'htmlGuard')

const squish = (value: string): string => value.replace(/\s+/g, ' ').trim()

const htmlNodes = (doc: Node): { node: Node; pos: number; value: string }[] => {
  const found: { node: Node; pos: number; value: string }[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'html') found.push({ node, pos, value: squish(String(node.attrs.value)) })
  })
  return found
}

const fragmentHasHtml = (fragment: Fragment): boolean => {
  let found = false
  fragment.descendants((node) => {
    if (node.type.name === 'html') {
      found = true
      return false
    }
    return !found
  })
  return found
}

const mayChangeHtml = (transactions: readonly Transaction[]): boolean =>
  transactions.some(
    (tr) =>
      tr.docChanged &&
      tr.steps.some((step) => {
        if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return false
        if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
          return fragmentHasHtml(step.slice.content)
        }
        return true
      }),
  )

const isSynced = (tr: Transaction): boolean => Boolean(tr.getMeta(ySyncPluginKey))

const htmlGuardProse = $prose((ctx) => {
  const seen = new Map<string, number>()
  let lastDoc: Node | null = null
  const remember = (doc: Node): void => {
    const counts = new Map<string, number>()
    for (const { value } of htmlNodes(doc)) counts.set(value, (counts.get(value) ?? 0) + 1)
    counts.forEach((count, value) => seen.set(value, Math.max(seen.get(value) ?? 0, count)))
  }

  return new Plugin({
    key: new PluginKey('HTML_GUARD'),
    appendTransaction: (transactions, oldState, newState) => {
      const { needsAccount, onKeptAsText } = ctx.get(htmlGuardCtx.key)
      if (!needsAccount() || !transactions.some((tr) => tr.docChanged)) return null
      if (oldState.doc !== lastDoc) remember(oldState.doc)
      if (transactions.some((tr) => tr.docChanged && isSynced(tr))) {
        remember(newState.doc)
        lastDoc = newState.doc
        return null
      }
      if (!mayChangeHtml(transactions)) {
        lastDoc = newState.doc
        return null
      }

      const survivingPos = new Set<number>()
      for (const { pos } of htmlNodes(oldState.doc)) {
        let mapped = pos
        let alive = true
        for (const tr of transactions) {
          if (!tr.docChanged) continue
          const result = tr.mapping.mapResult(mapped)
          if (result.deleted) {
            alive = false
            break
          }
          mapped = result.pos
        }
        if (alive) survivingPos.add(mapped)
      }

      const allNodes = htmlNodes(newState.doc)
      const counts = new Map<string, number>()
      for (const { pos, value } of allNodes) {
        if (survivingPos.has(pos)) counts.set(value, (counts.get(value) ?? 0) + 1)
      }
      const extra = allNodes.filter(({ pos, value }) => {
        if (survivingPos.has(pos)) return false
        counts.set(value, (counts.get(value) ?? 0) + 1)
        return counts.get(value)! > (seen.get(value) ?? 0)
      })
      if (extra.length === 0) {
        lastDoc = newState.doc
        return null
      }

      const { schema } = newState
      const tr = newState.tr
      for (const { node, pos } of extra.reverse()) {
        const lines = String(node.attrs.value).split(/\r?\n/)
        const text = lines.flatMap((line, index) => [
          ...(index > 0 ? [schema.nodes.hardbreak.create({ isInline: true })] : []),
          ...(line ? [schema.text(line, node.marks)] : []),
        ])
        tr.replaceWith(pos, pos + node.nodeSize, Fragment.from(text))
      }
      lastDoc = tr.doc
      onKeptAsText?.()
      return tr
    },
  })
})

export const htmlGuard = [htmlGuardCtx, htmlGuardProse].flat()

export function addsHtml(before: Node, after: Node): boolean {
  const afterNodes = htmlNodes(after)
  if (afterNodes.length === 0) return false
  const counts = new Map<string, number>()
  for (const { value } of htmlNodes(before)) counts.set(value, (counts.get(value) ?? 0) + 1)
  return afterNodes.some(({ value }) => {
    counts.set(value, (counts.get(value) ?? 0) - 1)
    return counts.get(value)! < 0
  })
}

export function keepRefusedHtmlAsText(ydoc: Y.Doc, refused: Record<string, number>): number {
  const own: Y.XmlElement[] = []
  const visit = (parent: Y.XmlFragment): void => {
    for (const child of parent.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue
      if (child.nodeName === 'html' && child._item?.id.client === ydoc.clientID) own.push(child)
      visit(child)
    }
  }
  visit(ydoc.getXmlFragment('prosemirror'))
  own.sort((a, b) => b._item!.id.clock - a._item!.id.clock)

  const left = new Map(Object.entries(refused))
  let turned = 0
  ydoc.transact(() => {
    for (const element of own) {
      const value = String(element.getAttribute('value') ?? '')
      const count = left.get(squish(value)) ?? 0
      const parent = element.parent
      if (count === 0 || !(parent instanceof Y.XmlFragment)) continue
      const index = parent.toArray().indexOf(element)
      const lines = value.split(/\r?\n/).flatMap((line, at) => {
        const parts: (Y.XmlElement | Y.XmlText)[] = []
        if (at > 0) {
          const lineBreak = new Y.XmlElement<{ isInline: boolean }>('hardbreak')
          lineBreak.setAttribute('isInline', true)
          parts.push(lineBreak as unknown as Y.XmlElement)
        }
        if (line) parts.push(new Y.XmlText(line))
        return parts
      })
      parent.delete(index, 1)
      parent.insert(index, lines)
      left.set(squish(value), count - 1)
      turned += 1
    }
  })
  return turned
}
