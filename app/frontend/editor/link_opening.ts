import type { EditorView } from '@milkdown/kit/prose/view'

const OPENABLE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])
// Signed Active Storage paths (blob redirect/proxy and the disk service).
// These URLs authenticate through their own signature, not the session, so
// they load fine in an external browser context.
const FILE_PATH_PREFIX = '/rails/active_storage/'

// Server-rendered on first paint when the request came from the Ruby Native
// iOS/Android shell (see app/views/layouts/application.html.erb).
function inNativeShell(): boolean {
  return document.documentElement.hasAttribute('data-native-app')
}

export function openEditorLink(view: EditorView, event: Event): boolean {
  if (!(event instanceof MouseEvent) || event.button !== 0 || event.defaultPrevented) {
    return false
  }

  const target = event.target
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null
  const anchor = element?.closest<HTMLAnchorElement>('a[href]')
  if (!anchor || !view.dom.contains(anchor)) return false

  let url: URL
  try {
    url = new URL(anchor.href, window.location.href)
  } catch {
    return false
  }
  if (!OPENABLE_LINK_PROTOCOLS.has(url.protocol)) return false

  event.preventDefault()
  // Inside the Ruby Native shell, window.open leaves the WKWebView for an
  // external browser context that carries none of the app's cookies — a
  // same-origin page link would land the signed-in user on a logged-out
  // session. Navigate the webview itself instead: the session carries and
  // the target page renders its own native chrome (including back).
  // Signed file URLs are deliberately excluded — they work externally via
  // their signature, while an in-place raw-file page would strand the user
  // with no back affordance in the shell's Normal Mode.
  const sameOriginPage =
    url.origin === window.location.origin && !url.pathname.startsWith(FILE_PATH_PREFIX)
  if (inNativeShell() && sameOriginPage) {
    if (typeof window.RubyNative?.visit === 'function') window.RubyNative.visit(url.href)
    else window.location.assign(url.href)
    return true
  }
  window.open(url.href, '_blank', 'noopener,noreferrer')
  return true
}
