import { $ctx, $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Fragment, type Node } from '@milkdown/kit/prose/model'
import { ySyncPluginKey } from 'y-prosemirror'

export interface DocumentNotice {
  text: string
  offerSignIn?: boolean
}

export const HTML_ACCOUNT_NOTICE = 'Creating or suggesting HTML needs an account'
export const HTML_KEPT_AS_TEXT_NOTICE: DocumentNotice = {
  text: `${HTML_ACCOUNT_NOTICE}, so it was kept as text.`,
  offerSignIn: true,
}
export const HTML_NOT_SAVED = `${HTML_ACCOUNT_NOTICE}. Your latest changes are not saved; copy them before you leave this page.`

export const htmlGuardCtx = $ctx<
  { needsAccount: () => boolean; onKeptAsText: (() => void) | null },
  'htmlGuard'
>({ needsAccount: () => false, onKeptAsText: null }, 'htmlGuard')

const EMPTY_LINES = ['<br />', '<br>', '<br >', '<br/>']

const htmlNodes = (doc: Node): { node: Node; pos: number }[] => {
  const found: { node: Node; pos: number }[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'html' && !EMPTY_LINES.includes(String(node.attrs.value).trim())) found.push({ node, pos })
  })
  return found
}

export const hasHtml = (doc: Node): boolean => htmlNodes(doc).length > 0

const isSynced = (tr: Transaction): boolean => Boolean(tr.getMeta(ySyncPluginKey))

/** Without an account, HTML added on this page becomes text. HTML that came
 *  from others stays as it is. */
const htmlGuardProse = $prose((ctx) => {
  return new Plugin({
    key: new PluginKey('HTML_GUARD'),
    appendTransaction: (transactions, oldState, newState) => {
      const { needsAccount, onKeptAsText } = ctx.get(htmlGuardCtx.key)
      if (!needsAccount() || !transactions.some((tr) => tr.docChanged)) return null
      if (transactions.some((tr) => tr.docChanged && isSynced(tr))) return null
      const added = htmlNodes(newState.doc)
      if (added.length === 0 || hasHtml(oldState.doc)) return null

      const { schema } = newState
      const tr = newState.tr
      for (const { node, pos } of added.reverse()) {
        const text = String(node.attrs.value)
          .split(/\r?\n/)
          .flatMap((line, index) => [
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
