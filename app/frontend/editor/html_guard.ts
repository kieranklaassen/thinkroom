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

const FRONTMATTER_HTML = /(?:^[ \t]*(?:---[ \t]*$|`{3,}|~{3,})|<\/?[a-zA-Z!?])/m

const frontmatterHasHtml = (value: string): boolean => FRONTMATTER_HTML.test(value.replace(/\r\n?/g, '\n'))

const htmlNodes = (doc: Node): { node: Node; pos: number; value: string }[] => {
  const found: { node: Node; pos: number; value: string }[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'html') found.push({ node, pos, value: squish(String(node.attrs.value)) })
  })
  return found
}

const frontmatterHtmlNodes = (doc: Node): { node: Node; pos: number; value: string }[] => {
  const found: { node: Node; pos: number; value: string }[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'frontmatter') {
      const value = String(node.attrs.value ?? '')
      if (frontmatterHasHtml(value)) found.push({ node, pos, value: squish(value) })
    }
  })
  return found
}

const fragmentHasHtml = (fragment: Fragment): boolean => {
  let found = false
  fragment.descendants((node) => {
    if (node.type.name === 'html' || node.type.name === 'frontmatter') {
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

const mapSurvivingValues = (
  entries: { pos: number; value: string }[],
  transactions: readonly Transaction[],
): Map<number, string> => {
  const surviving = new Map<number, string>()
  for (const { pos, value } of entries) {
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
    if (alive) surviving.set(mapped, value)
  }
  return surviving
}

const findExtraNodes = (
  allNodes: { node: Node; pos: number; value: string }[],
  survivingValues: Map<number, string>,
  seen: Map<string, number>,
): { node: Node; pos: number; value: string }[] => {
  const counts = new Map<string, number>()
  for (const { pos, value } of allNodes) {
    if (survivingValues.get(pos) === value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return allNodes.filter(({ pos, value }) => {
    if (survivingValues.get(pos) === value) return false
    counts.set(value, (counts.get(value) ?? 0) + 1)
    return counts.get(value)! > (seen.get(value) ?? 0)
  })
}

const htmlGuardProse = $prose((ctx) => {
  const seenHtml = new Map<string, number>()
  const seenFrontmatter = new Map<string, number>()
  let lastDoc: Node | null = null
  const rememberList = (entries: { value: string }[], target: Map<string, number>): void => {
    const counts = new Map<string, number>()
    for (const { value } of entries) counts.set(value, (counts.get(value) ?? 0) + 1)
    counts.forEach((count, value) => target.set(value, Math.max(target.get(value) ?? 0, count)))
  }
  const remember = (doc: Node): void => {
    rememberList(htmlNodes(doc), seenHtml)
    rememberList(frontmatterHtmlNodes(doc), seenFrontmatter)
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

      const extraHtml = findExtraNodes(
        htmlNodes(newState.doc),
        mapSurvivingValues(htmlNodes(oldState.doc), transactions),
        seenHtml,
      )
      const extraFrontmatter = findExtraNodes(
        frontmatterHtmlNodes(newState.doc),
        mapSurvivingValues(frontmatterHtmlNodes(oldState.doc), transactions),
        seenFrontmatter,
      )
      if (extraHtml.length === 0 && extraFrontmatter.length === 0) {
        lastDoc = newState.doc
        return null
      }

      const { schema } = newState
      const tr = newState.tr
      const replacements = [
        ...extraHtml.map((entry) => ({ ...entry, kind: 'html' as const })),
        ...extraFrontmatter.map((entry) => ({ ...entry, kind: 'frontmatter' as const })),
      ].sort((a, b) => b.pos - a.pos)

      for (const { node, pos, kind } of replacements) {
        if (kind === 'frontmatter') {
          const raw = String(node.attrs.value ?? '')
          const codeBlock = schema.nodes.code_block
          if (codeBlock) {
            tr.replaceWith(
              pos,
              pos + node.nodeSize,
              codeBlock.create({ language: 'yaml' }, raw ? schema.text(raw) : undefined),
            )
          } else {
            const para = schema.nodes.paragraph
            tr.replaceWith(pos, pos + node.nodeSize, para.create(null, raw ? schema.text(raw) : undefined))
          }
          continue
        }
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

const addsEntries = (before: { value: string }[], after: { value: string }[]): boolean => {
  if (after.length === 0) return false
  const counts = new Map<string, number>()
  for (const { value } of before) counts.set(value, (counts.get(value) ?? 0) + 1)
  return after.some(({ value }) => {
    counts.set(value, (counts.get(value) ?? 0) - 1)
    return counts.get(value)! < 0
  })
}

export function addsHtml(before: Node, after: Node): boolean {
  return (
    addsEntries(htmlNodes(before), htmlNodes(after)) ||
    addsEntries(frontmatterHtmlNodes(before), frontmatterHtmlNodes(after))
  )
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
