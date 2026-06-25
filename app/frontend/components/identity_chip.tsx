import { useEffect, useRef, useState } from 'react'
import { router } from '@inertiajs/react'
import type { UserIdentity } from '../editor/identity'

interface Props {
  identity: UserIdentity
  guest: boolean
  authenticated?: boolean
  /** Fired after the server confirms the session write — the caller applies
   *  the live side effects (awareness label, provenance identity). `null`
   *  means cleared back to guest. */
  onRenamed: (name: string | null) => void
}

/**
 * Who you are, in the header. Chrome-toggle register, no modal — the
 * OwnershipChip inline-expand pattern with an input instead of buttons:
 *   display  → avatar dot + name (guests: "‹name› · guest")
 *   editing  → inline input, Enter saves, Esc cancels, empty clears to guest
 *   saving   → input locked while the POST is in flight
 *   error    → input stays open with an inline retry message
 *
 * The live identity (cursor label, provenance) only flips in onSuccess —
 * a failed save must never leave this tab signing a name the session
 * doesn't hold.
 */
export function IdentityChip({ identity, guest, authenticated = false, onRenamed }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
    // Mobile: the soft keyboard must not occlude the input.
    inputRef.current?.scrollIntoView({ block: 'nearest' })
  }, [editing])

  const close = () => {
    setEditing(false)
    setSaving(false)
    setFailed(false)
    triggerRef.current?.focus()
  }

  const save = () => {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setFailed(false)
    const name = draft.trim()
    let succeeded = false
    router.post(
      '/identity',
      { name },
      {
        only: ['viewer'],
        preserveScroll: true,
        async: true,
        onSuccess: () => {
          succeeded = true
          onRenamed(name.length > 0 ? name : null)
          close()
        },
        // Inertia's onError only covers validation errors; CSRF/network/5xx
        // failures land only in onFinish — recover there or the disabled
        // input (which can't receive Escape) locks forever.
        onFinish: () => {
          inFlight.current = false
          if (!succeeded) {
            setSaving(false)
            setFailed(true)
          }
        },
      },
    )
  }

  if (editing) {
    return (
      <span className="identity-edit">
        <input
          ref={inputRef}
          className="identity-input"
          type="text"
          placeholder="Your name"
          maxLength={80}
          value={draft}
          disabled={saving}
          aria-label="Your display name — leave empty to stay a guest"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              save()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              close()
            }
          }}
        />
        {failed && <span className="identity-error">Couldn’t save — try again</span>}
      </span>
    )
  }

  if (authenticated) {
    return (
      <span className="chrome-toggle identity-chip identity-chip--account" title={`Signed in as ${identity.name}`}>
        <span className="identity-dot" style={{ background: identity.color }} aria-hidden />
        <span className="identity-name">{identity.name}</span>
      </span>
    )
  }

  return (
    <button
      ref={triggerRef}
      className="chrome-toggle identity-chip"
      title={guest ? 'You’re a guest — click to set your name' : `Signed as ${identity.name} — click to change`}
      aria-label={
        guest
          ? `Set your display name — currently ${identity.name} (guest)`
          : `Change your display name — currently ${identity.name}`
      }
      onClick={() => {
        setDraft(guest ? '' : identity.name)
        setEditing(true)
      }}
    >
      <span className="identity-dot" style={{ background: identity.color }} aria-hidden />
      <span className="identity-name">{identity.name}</span>
      {guest && <span className="identity-guest">· guest</span>}
    </button>
  )
}
