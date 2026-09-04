import { setCookie } from './cookies'

export type ThemeName = 'proof' | 'whitey'

/** Apply browser appearance without touching the collaborative editor state. */
export function applyTheme(theme: ThemeName): void {
  const editor = document.querySelector('.doc-live-editor .ProseMirror, .doc-static-preview .ProseMirror')
  const headerBottom = document.querySelector('.doc-header')?.getBoundingClientRect().bottom ?? 0
  const anchor = Array.from(editor?.querySelectorAll('p, h1, h2, h3, h4, pre, li, figure') ?? [])
    .find((element) => {
      const rect = element.getBoundingClientRect()
      return rect.bottom > headerBottom && rect.top < window.innerHeight
    })
  const before = anchor?.getBoundingClientRect().top

  document.documentElement.dataset.theme = theme
  if (anchor && before !== undefined) {
    window.scrollBy({ top: anchor.getBoundingClientRect().top - before, behavior: 'instant' })
  }
  // Existing margin and floating-chrome listeners remeasure changed geometry.
  window.dispatchEvent(new Event('resize'))
  setCookie('proof_theme', theme)
  try {
    localStorage.setItem('proof:theme', theme)
  } catch {
    // Compatibility mirror only; cookies own first paint, memory owns this visit.
  }
}
