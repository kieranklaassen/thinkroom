import { useEffect, useRef, useState, type FormEvent } from 'react'
import { truncate } from '../lib/truncate'

interface Props {
  /** The selected text the suggestion proposes to replace. */
  target: string
  position: { x: number; y: number }
  onSubmit: (replacement: string) => void
  onCancel: () => void
}

/**
 * Suggest-mode composer: quoted original + replacement textarea, floating at
 * the selection (a fixed bottom sheet on small screens via CSS — same shape
 * the comment composer takes when it routes into the mobile sheet).
 *
 * A dedicated component rather than a parameterized comment composer: the
 * comment form is one body field embedded in the comments rail; this one is
 * an original→replacement pair posting replaces/anchor_text to a different
 * endpoint — parameterizing would entangle two unrelated forms.
 *
 * Empty replacement disables submit (no server round-trip); validation
 * errors (size caps) surface via the Inertia error shape and redirect_back,
 * mirroring comments.
 */
export function SuggestComposer({ target, position, onSubmit, onCancel }: Props) {
  const [body, setBody] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <form
      className="suggest-composer"
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-label="Suggest a change"
      onSubmit={submit}
    >
      <del className="suggest-composer-old">{truncate(target, 120)}</del>
      <textarea
        ref={textareaRef}
        className="comment-input"
        rows={3}
        placeholder="Suggest replacement text…"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event)
          if (event.key === 'Escape') onCancel()
        }}
      />
      <div className="comment-composer-actions">
        <button type="submit" className="btn-accept" disabled={!body.trim()}>
          Suggest
        </button>
        <button type="button" className="btn-reject" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
