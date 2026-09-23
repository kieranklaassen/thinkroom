import { useCallback, useRef, useState } from 'react'
import { router } from '@inertiajs/react'

/** Minimum shape a pin needs to render optimistically in the Pinned list. */
export interface PinnableDocument {
  slug: string
  title: string
  tags: string[]
  created_at: string
  created_label: string
  owner_name?: string | null
  yours?: boolean
}

export type PinnedDocument = PinnableDocument & { pinned_at: string }

/**
 * Pin/unpin for the documents index, shaped like useClaim: the `pinned` prop
 * is updated optimistically (Inertia rolls it back if the request fails), a
 * synchronous per-slug ref ignores clicks while that slug's request is in
 * flight, and the settle reload is scoped by `only` so the WebMCP manifest is
 * never re-shipped. Every star on the page derives its state from `pinned`.
 */
export function usePin(only: string[]) {
  const inFlight = useRef(new Set<string>())
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)

  const settle = (slug: string) => {
    inFlight.current.delete(slug)
    setPending((current) => {
      const next = new Set(current)
      next.delete(slug)
      return next
    })
  }

  const toggle = useCallback(
    (document: PinnableDocument, pinned: boolean): boolean => {
      if (inFlight.current.has(document.slug)) return false
      inFlight.current.add(document.slug)
      setPending((current) => new Set(current).add(document.slug))
      setError(null)

      const visit = router.optimistic<{ pinned: PinnedDocument[] }>((props) => {
        const current = props.pinned ?? []
        return {
          pinned: pinned
            ? current.filter((row) => row.slug !== document.slug)
            : [{ ...document, pinned_at: new Date().toISOString() }, ...current],
        }
      })
      const options = {
        preserveScroll: true,
        only,
        async: true,
        onError: (errors: Record<string, string | string[]>) => {
          const message = Array.isArray(errors.pin) ? errors.pin[0] : errors.pin
          setError(message ?? 'Pinning failed — try again')
        },
        onFinish: () => settle(document.slug),
      }
      if (pinned) {
        visit.delete(`/d/${document.slug}/pin`, options)
      } else {
        visit.post(`/d/${document.slug}/pin`, {}, options)
      }
      return true
    },
    // `only` is a stable module-level array at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return { toggle, pending, error }
}
