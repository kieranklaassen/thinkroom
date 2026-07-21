import { useEffect, useState } from 'react'
import { patchJSON } from '../lib/csrf'
import {
  HIGHLIGHT_COLORS,
  type HighlightColorId,
  type HighlightGroup,
  type HighlightSnippet,
} from '../editor/text_highlighter'

interface Props {
  /** Colors currently present in the document, palette order (from scan). */
  groups: HighlightGroup[]
  /** Persisted per-document color names ({ yellow: 'Urgent' }). */
  names: Record<string, string>
  /** Writers can rename colors; read-only viewers see names as plain text. */
  canWrite: boolean
  slug: string
  onJumpTo: (snippet: HighlightSnippet) => void
}

const swatchColor = (id: HighlightColorId): string =>
  HIGHLIGHT_COLORS.find((color) => color.id === id)?.swatch ?? 'transparent'

const colorLabel = (id: HighlightColorId): string =>
  HIGHLIGHT_COLORS.find((color) => color.id === id)?.label ?? id

/**
 * Rail legend for the highlighter: each color used in the document, its
 * user-given name, and the highlighted snippets grouped under it. Renders
 * nothing while the document has no highlights.
 */
export function HighlightLegendPanel({ groups, names, canWrite, slug, onJumpTo }: Props) {
  // Committed names shown immediately; replaced whenever the server prop
  // refreshes (the broadcast-driven reload is the source of truth).
  const [localNames, setLocalNames] = useState(names)
  // In-progress edits keyed by color, live only while the input is dirty.
  const [drafts, setDrafts] = useState<Partial<Record<HighlightColorId, string>>>({})

  useEffect(() => {
    setLocalNames(names)
  }, [names])

  if (groups.length === 0) return null

  const commitName = (color: HighlightColorId) => {
    const draft = drafts[color]
    if (draft === undefined) return
    setDrafts(({ [color]: _committed, ...rest }) => rest)
    const value = draft.trim()
    if (value === (localNames[color] ?? '')) return
    setLocalNames((prev) => {
      if (value) return { ...prev, [color]: value }
      const { [color]: _removed, ...rest } = prev
      return rest
    })
    void patchJSON(`/d/${slug}/highlight_names`, { names: { [color]: value } })
  }

  return (
    <section className="rail-section" aria-label="Highlights">
      <header className="rail-heading">
        <h2>Highlights</h2>
      </header>
      <ul className="highlight-legend-list">
        {groups.map((group) => (
          <li key={group.color} className="highlight-legend-color">
            <div className="highlight-legend-key">
              <span
                className="highlight-legend-swatch"
                style={{ background: swatchColor(group.color) }}
              />
              <input
                className="highlight-legend-name"
                type="text"
                value={drafts[group.color] ?? localNames[group.color] ?? ''}
                placeholder={colorLabel(group.color)}
                aria-label={`Name for ${colorLabel(group.color)} highlights`}
                maxLength={64}
                disabled={!canWrite}
                onChange={(event) =>
                  setDrafts((prev) => ({ ...prev, [group.color]: event.target.value }))
                }
                onBlur={() => commitName(group.color)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') {
                    setDrafts(({ [group.color]: _discarded, ...rest }) => rest)
                    event.currentTarget.blur()
                  }
                }}
              />
            </div>
            <ul className="highlight-legend-snippets">
              {group.snippets.map((snippet) => (
                <li key={`${snippet.from}-${snippet.to}`}>
                  <button
                    className="highlight-legend-snippet"
                    onClick={() => onJumpTo(snippet)}
                    title="Jump to text"
                  >
                    {snippet.text}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  )
}
