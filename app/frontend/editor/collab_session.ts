import * as Y from 'yjs'
import { CableProvider } from './cable_provider'
import type { UserIdentity } from './identity'

export interface CollabSession {
  ydoc: Y.Doc
  provider: CableProvider
  refs: number
  destroyTimer: ReturnType<typeof setTimeout> | null
  canWrite: boolean
  connectionIdentity: string
}

// Sessions survive React StrictMode's mount→unmount→mount cycle. Without
// this, the first (immediately discarded) provider wins the server's seed
// claim and dies before applying the template, leaving the doc empty until
// the claim times out. Real teardown happens after a short grace period.
const sessions = new Map<string, CollabSession>()

export function getSession(slug: string): CollabSession | undefined {
  return sessions.get(slug)
}

export function acquireSession(
  slug: string,
  identity: UserIdentity,
  canWrite: boolean,
  connectionIdentity: string,
  initialStateB64?: string | null,
): CollabSession {
  let session = sessions.get(slug)
  if (session && (session.canWrite !== canWrite || session.connectionIdentity !== connectionIdentity)) {
    if (session.destroyTimer) clearTimeout(session.destroyTimer)
    session.provider.destroy()
    session.ydoc.destroy()
    sessions.delete(slug)
    session = undefined
  }
  if (!session) {
    const ydoc = new Y.Doc()
    // Hydrate from the server-rendered state the moment the doc exists, so
    // the editor binds an already-populated doc and content is in its first
    // paint; Yjs converges idempotently when the provider's sync lands.
    // The clients-empty guard is redundant for a just-created Y.Doc but
    // keeps the hydration idempotent if this block ever runs on a doc
    // that already carries state.
    if (initialStateB64 && ydoc.store.clients.size === 0) {
      try {
        Y.applyUpdate(
          ydoc,
          Uint8Array.from(atob(initialStateB64), (c) => c.charCodeAt(0)),
          'server-hydrate',
        )
      } catch {
        // corrupt/stale prop — fall back to the wait-for-synced path
      }
    }
    const provider = new CableProvider(ydoc, slug, { canWrite, connectionIdentity })
    provider.awareness.setLocalStateField('user', identity)
    session = { ydoc, provider, refs: 0, destroyTimer: null, canWrite, connectionIdentity }
    sessions.set(slug, session)
  }
  if (session.destroyTimer) {
    clearTimeout(session.destroyTimer)
    session.destroyTimer = null
  }
  session.refs += 1
  return session
}

export function releaseSession(slug: string): void {
  const session = sessions.get(slug)
  if (!session) return
  session.refs -= 1
  if (session.refs > 0) return
  session.destroyTimer = setTimeout(() => {
    sessions.delete(slug)
    session.provider.destroy()
    session.ydoc.destroy()
  }, 1000)
}

// History restores replay stale props: a back-navigation remounts the page
// with the original seed_granted: true long after the template was applied
// and synced. Re-applying onto a fresh local doc would duplicate the
// template when the server state merges in, so grant consumption is made
// durable per tab. The server generation is part of the key because owner
// CLI replacement keeps the slug while resetting the CRDT state to a new
// seed source; that new generation must be allowed to seed again.
const seedAppliedKey = (slug: string, seedVersion?: string | null) =>
  `pruf:seed-applied:${slug}:${seedVersion ?? 'unknown'}`

export function seedAlreadyApplied(slug: string, seedVersion?: string | null): boolean {
  try {
    return sessionStorage.getItem(seedAppliedKey(slug, seedVersion)) === '1'
  } catch {
    return false
  }
}

export function markSeedApplied(slug: string, seedVersion?: string | null): void {
  try {
    sessionStorage.setItem(seedAppliedKey(slug, seedVersion), '1')
  } catch {
    // best effort — worst case is the pre-fix behavior on history restore
  }
}
