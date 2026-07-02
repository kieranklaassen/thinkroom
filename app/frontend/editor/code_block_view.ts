import { codeBlockAttr, codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import { $view } from '@milkdown/kit/utils'
import type { NodeViewConstructor } from '@milkdown/kit/prose/view'

/**
 * Node view for plain code blocks whose only job is mutation scoping.
 *
 * The preset's schema-rendered <pre><code> has no node view, so ProseMirror's
 * DOMObserver treats ANY foreign DOM inside the <pre> as a document edit and
 * re-renders the node. The rich-block width handle lives inside the <pre>
 * (absolute-positioned chrome, like on sketches and tables — which are node
 * views and unaffected): PM re-rendered the block and deleted the handle, the
 * handle plugin's MutationObserver rebuilt it, and the two fought at 60fps on
 * every document with a code block — a full core burned at idle, per-frame
 * updateState re-imposing the state selection over in-flight drags (the
 * "comment-mode selection stomping"), and visible code-block shimmer while
 * scrolling.
 *
 * Rendering matches the schema's toDOM exactly (pre[data-language] > code);
 * only mutations outside the editable <code> content are ignored.
 */
export const codeBlockView = $view(
  codeBlockSchema.node,
  (ctx): NodeViewConstructor => (node) => {
    const dom = document.createElement('pre')
    const contentDOM = document.createElement('code')

    // Writes only on real changes: setting an attribute to its current value
    // still queues a mutation record, which would wake the width-handle
    // plugin's MutationObserver on every keystroke inside the block.
    const setAttrs = (element: HTMLElement, attrs: Record<string, unknown> | undefined) => {
      Object.entries(attrs ?? {}).forEach(([key, value]) => {
        if (value == null) return
        const next = String(value)
        if (element.getAttribute(key) !== next) element.setAttribute(key, next)
      })
    }

    const applyAttrs = (current: typeof node) => {
      const attrs = ctx.get(codeBlockAttr.key)(current)
      setAttrs(dom, attrs.pre)
      setAttrs(contentDOM, attrs.code)
      const language = current.attrs.language as string
      if (language && language.length > 0) {
        if (dom.dataset.language !== language) dom.dataset.language = language
      } else {
        delete dom.dataset.language
      }
    }

    applyAttrs(node)
    dom.appendChild(contentDOM)

    return {
      dom,
      contentDOM,
      update: (next) => {
        if (next.type !== node.type) return false
        applyAttrs(next)
        return true
      },
      ignoreMutation: (mutation) => {
        // Selection reads must stay PM's business; so must anything touching
        // the editable code content. Everything else inside the <pre> is
        // decorative chrome (the width handle and its aria updates).
        if (mutation.type === 'selection') return false
        if (mutation.target === contentDOM || contentDOM.contains(mutation.target)) return false
        return true
      },
    }
  },
)
