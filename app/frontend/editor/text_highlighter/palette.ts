/** Fixed 10-color marker palette. Ids must stay in sync with
 *  HighlightPalette::COLOR_IDS on the server (sanitizer + legend names). */
export const HIGHLIGHT_COLORS = [
  { id: 'yellow', label: 'Yellow', swatch: '#eab308' },
  { id: 'green', label: 'Green', swatch: '#22a04c' },
  { id: 'blue', label: 'Blue', swatch: '#2f80d8' },
  { id: 'pink', label: 'Pink', swatch: '#e253a1' },
  { id: 'purple', label: 'Purple', swatch: '#8b5cf6' },
  { id: 'orange', label: 'Orange', swatch: '#f97316' },
  { id: 'teal', label: 'Teal', swatch: '#14b8a6' },
  { id: 'red', label: 'Red', swatch: '#dc4b3e' },
  { id: 'gray', label: 'Gray', swatch: '#8b8578' },
  { id: 'brown', label: 'Brown', swatch: '#a16f45' },
] as const

export type HighlightColorId = (typeof HIGHLIGHT_COLORS)[number]['id']

const COLOR_IDS: ReadonlySet<string> = new Set(HIGHLIGHT_COLORS.map((color) => color.id))

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColorId = 'yellow'

export function isHighlightColorId(value: string): value is HighlightColorId {
  return COLOR_IDS.has(value)
}
