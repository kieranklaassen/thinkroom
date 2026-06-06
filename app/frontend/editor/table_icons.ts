/**
 * Icons for the table-block editing chrome, in the app's quiet line style
 * (1.5px stroke, currentColor). The component injects these strings as
 * (DOMPurify-sanitized) innerHTML into `span.milkdown-icon` — the default
 * icons are bare text like '+' and 'left', which is why overriding is
 * mandatory rather than cosmetic.
 */

const svg = (paths: string): string =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

export const plusIcon = svg('<path d="M12 5v14M5 12h14"/>')

export const trashIcon = svg(
  '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
)

export const alignLeftIcon = svg('<path d="M4 6h16M4 12h10M4 18h13"/>')

export const alignCenterIcon = svg('<path d="M4 6h16M7 12h10M5.5 18h13"/>')

export const alignRightIcon = svg('<path d="M4 6h16M10 12h10M7 18h13"/>')

/** Six-dot grip, the conventional drag affordance. */
export const gripIcon = svg(
  '<circle cx="9" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1" fill="currentColor" stroke="none"/>',
)
