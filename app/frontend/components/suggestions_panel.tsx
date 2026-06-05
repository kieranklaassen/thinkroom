import { useState, type FormEvent } from 'react'

interface Props {
  aiPending: boolean
  onAskAi: (instruction: string) => void
}

/** The Ask AI composer. Pending suggestions themselves render as margin
 *  cards beside the text they touch (see MarginSuggestions). */
export function AskAiPanel({ aiPending, onAskAi }: Props) {
  const [instruction, setInstruction] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onAskAi(instruction.trim())
    setInstruction('')
  }

  return (
    <section className="rail-section" aria-label="Ask AI">
      <header className="rail-heading">
        <h2>Ask AI</h2>
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

      <p className="rail-empty">
        Proposals appear in the margin, next to the text they touch — accept or
        reject them there.
      </p>
    </section>
  )
}
