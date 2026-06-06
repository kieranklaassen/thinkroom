import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { truncate } from '../lib/truncate'

interface Props {
  /** Placement ref from useAnchoredPopover — also the outside-click boundary. */
  rootRef: RefObject<HTMLFormElement | null>
  anchor: string
  position: { x: number; y: number; detached: boolean } | null
  onSubmit: (body: string) => void
  onCancel: () => void
}

/**
 * The desktop comment composer, anchored next to the selected text
 * (Google-Docs style). Lifecycle contract: only Escape, Cancel, and Submit
 * close it — an outside click dismisses only while the draft is empty, so
 * typed text is never silently lost.
 */
export function AnchoredComposer({ rootRef, anchor, position, onSubmit, onCancel }: Props) {
  const [body, setBody] = useState('')
  const bodyRef = useRef(body)
  bodyRef.current = body
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const focusedOnce = useRef(false)

  // Autofocus once placed — the pre-measure hidden phase isn't focusable.
  const placed = position !== null
  useEffect(() => {
    if (placed && !focusedOnce.current) {
      focusedOnce.current = true
      textareaRef.current?.focus()
    }
  }, [placed])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current
      if (!root || root.contains(event.target as Node)) return
      if (!bodyRef.current.trim()) onCancel()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [rootRef, onCancel])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <form
      ref={rootRef}
      className={`comment-composer comment-composer--anchored ${placed ? 'is-placed' : ''}`}
      style={position ? { left: position.x, top: position.y } : undefined}
      inert={!placed}
      onSubmit={submit}
      aria-label="Add a comment"
    >
      {anchor && <blockquote className="comment-quote">{truncate(anchor, 120)}</blockquote>}
      {position?.detached && (
        <p className="comment-composer-note">Original text changed — comment still posts.</p>
      )}
      <textarea
        ref={textareaRef}
        className="comment-input"
        rows={2}
        placeholder="Say something about this…"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event)
          if (event.key === 'Escape') onCancel()
        }}
      />
      <div className="comment-composer-actions">
        <button type="submit" className="btn-accept" disabled={!body.trim()}>
          Comment
        </button>
        <button type="button" className="btn-reject" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
