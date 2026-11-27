import { $ctx, $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Fragment, type Node } from '@milkdown/kit/prose/model'
import { ySyncPluginKey } from 'y-prosemirror'
import * as Y from 'yjs'

/** Starts every notice that offers to sign in. */
export const HTML_ACCOUNT_NOTICE = 'Adding HTML needs an account'
export const HTML_KEPT_AS_TEXT_NOTICE =
  'Adding HTML needs an account, so it was kept as text.'
export const HTML_NOT_SAVED_NOTICE =
  'Adding HTML needs an account. Changes since then are not saved; copy them before you leave this page.'

export const HTML_SNAPSHOT_NOTICE =
  'Adding HTML needs an account, so the saved copy of this document was not updated.'

export const htmlGuardCtx = $ctx<
  { needsAccount: () => boolean; onKeptAsText: (() => void) | null },
  'htmlGuard'
>({ needsAccount: () => false, onKeptAsText: null }, 'htmlGuard')

/** The server compares values with their space squeezed. */
const squish = (value: string): string => value.replace(/\s+/g, ' ').trim()

const htmlNodes = (doc: Node): { node: Node; pos: number; value: string }[] => {
  const found: { node: Node; pos: number; value: string }[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'html') found.push({ node, pos, value: squish(String(node.attrs.value)) })
  })
  return found
}

const isSynced = (tr: Transaction): boolean => Boolean(tr.getMeta(ySyncPluginKey))

/**
 * Without an account, HTML a local edit adds becomes the text it was written
 * as. What this page has seen in the document may come back, so moving and
 * undoing keep working, and so does everything that arrives from the server.
 */
const htmlGuardProse = $prose((ctx) => {
  const seen = new Map<string, number>()
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
      remember(oldState.doc)
      if (transactions.some((tr) => tr.docChanged && isSynced(tr))) {
        remember(newState.doc)
        return null
      }

      const counts = new Map<string, number>()
      const extra = htmlNodes(newState.doc).filter(({ value }) => {
        counts.set(value, (counts.get(value) ?? 0) + 1)
        return counts.get(value)! > (seen.get(value) ?? 0)
      })
      if (extra.length === 0) return null

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
      onKeptAsText?.()
      return tr
    },
  })
})

export const htmlGuard = [htmlGuardCtx, htmlGuardProse].flat()

/** Whether `after` holds raw HTML that `before` does not. */
export function addsHtml(before: Node, after: Node): boolean {
  const counts = new Map<string, number>()
  for (const { value } of htmlNodes(before)) counts.set(value, (counts.get(value) ?? 0) + 1)
  return htmlNodes(after).some(({ value }) => {
    counts.set(value, (counts.get(value) ?? 0) - 1)
    return counts.get(value)! < 0
  })
}

/**
 * Turns HTML the server refused into text: only nodes this page created, the
 * newest first, and no more than were refused. Returns how many it turned.
 */
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
