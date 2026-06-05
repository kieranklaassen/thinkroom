import { useEffect, useState, type FormEvent } from 'react'
import type { SuggestionPayload } from '../editor/suggestions'

interface Props {
  suggestions: SuggestionPayload[]
  aiPending: boolean
  onAccept: (suggestion: SuggestionPayload) => void
  onReject: (suggestion: SuggestionPayload) => void
  onAskAi: (instruction: string) => void
}

export function SuggestionsPanel({ suggestions, aiPending, onAccept, onReject, onAskAi }: Props) {
  const [instruction, setInstruction] = useState('')
  const [leaving, setLeaving] = useState<Set<number>>(new Set())

  // Forget leave-animations for cards that are gone from props.
  useEffect(() => {
    setLeaving((prev) => {
      const ids = new Set(suggestions.map((s) => s.id))
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [suggestions])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onAskAi(instruction.trim())
    setInstruction('')
  }

  const resolve = (suggestion: SuggestionPayload, action: (s: SuggestionPayload) => void) => {
    setLeaving((prev) => new Set(prev).add(suggestion.id))
    // Let the leave transition play before the optimistic prop removal.
    setTimeout(() => action(suggestion), 160)
  }

  return (
    <section className="rail-section" aria-label="Suggestions">
      <header className="rail-heading">
        <h2>Suggestions</h2>
        {suggestions.length > 0 && <span className="rail-count">{suggestions.length}</span>}
      </header>

      <form className="ask-ai" onSubmit={submit}>
        <input
          className="ask-ai-input"
          type="text"
          placeholder="Ask AI — e.g. “tighten the intro”"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          disabled={aiPending}
        />
        <button className="ask-ai-button" type="submit" disabled={aiPending}>
          {aiPending ? <span className="ask-ai-spinner" aria-label="Thinking" /> : 'Ask'}
        </button>
      </form>

      {suggestions.length === 0 && !aiPending && (
        <p className="rail-empty">
          No pending suggestions. Select text or ask the AI to propose an edit —
          it lands here for review.
        </p>
      )}

      <ul className="suggestion-list">
        {suggestions.map((suggestion) => (
          <li
            key={suggestion.id}
            className={`suggestion-card ${leaving.has(suggestion.id) ? 'is-leaving' : ''}`}
          >
            <div className="suggestion-meta">
              <span className={`author-chip author-chip--${suggestion.author_kind}`}>
                {suggestion.author_name}
              </span>
              {suggestion.intent && <span className="suggestion-intent">{suggestion.intent}</span>}
            </div>
            {suggestion.replaces && (
              <p className="suggestion-replaces">
                replaces <q>{truncate(suggestion.replaces, 90)}</q>
              </p>
            )}
            <p className="suggestion-body">{suggestion.body}</p>
            <div className="suggestion-actions">
              <button
                className="btn-accept"
                onClick={() => resolve(suggestion, onAccept)}
              >
                Accept
              </button>
              <button
                className="btn-reject"
                onClick={() => resolve(suggestion, onReject)}
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

const truncate = (text: string, length: number): string =>
  text.length > length ? `${text.slice(0, length)}…` : text
