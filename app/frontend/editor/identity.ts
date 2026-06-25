import { setCookie } from '../lib/cookies'

export interface UserIdentity {
  name: string
  color: string
}

/** The browser's guest identity as the server saw it, from the `pruf_guest`
 *  cookie included in the viewer prop. Null when no guest cookie was set. */
export interface ServerGuestIdentity {
  guest_name: string | null
  guest_color: string | null
}

// Plain cookie (presentation-only) mirroring the localStorage record so the
// server can render the guest name + color at first paint. Read in
// InertiaController#guest_identity_cookie.
const GUEST_COOKIE = 'pruf_guest'

const ADJECTIVES = [
  'Quiet', 'Amber', 'Swift', 'Gentle', 'Bold', 'Velvet', 'Lucid', 'Mellow',
  'Crimson', 'Sage', 'Golden', 'Patient', 'Curious', 'Steady', 'Bright',
]

const ANIMALS = [
  'Falcon', 'Otter', 'Heron', 'Lynx', 'Badger', 'Swift', 'Marten', 'Ibis',
  'Fox', 'Wren', 'Tern', 'Stoat', 'Plover', 'Vole', 'Kestrel',
]

// Muted, paper-friendly presence colors — readable as cursor labels on both themes.
const COLORS = [
  '#b65c3d', '#3d7ab6', '#6a994e', '#9d4edd', '#c08552',
  '#457b9d', '#bc4749', '#5f7470', '#7b6d8d', '#2a9d8f',
]

const STORAGE_KEY = 'proof:identity'

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

/**
 * Stable per-browser identity so reloads keep the same name and color.
 *
 * `serverName` is the session-stored chosen display name (the `viewer`
 * shared prop). When present it wins over the stored random name — but the
 * color always comes from the stored guest identity, and the localStorage
 * record is never overwritten by a chosen name, so clearing the session
 * name falls back to the same guest identity as before.
 */
export function userIdentity(
  serverName?: string | null,
  options?: { allowStorage?: boolean },
): UserIdentity {
  // Render-path callers (useForm initializers) must survive non-browser
  // environments where localStorage doesn't exist. `allowStorage: false` also
  // forces this deterministic shape on the client's first (hydration) render
  // so the server and client markup match — the stored guest identity is then
  // applied in a post-hydration effect.
  if (typeof window === 'undefined' || options?.allowStorage === false) {
    return { name: serverName ?? 'Anonymous', color: COLORS[0] }
  }
  const guest = guestIdentity()
  return serverName ? { ...guest, name: serverName } : guest
}

/**
 * The SSR-stable identity for the document header's first render. The server
 * already inlined the guest identity (name + color) from the `pruf_guest`
 * cookie into the viewer prop, so both the server render and the client's
 * first hydration render derive identity from props alone — byte-identical,
 * no localStorage read, no hydration mismatch.
 *
 * A chosen session name (serverName) always wins over the guest identity.
 * When neither is present (first-ever visit, before the cookie exists) it
 * falls back to the deterministic Anonymous shape; the stored localStorage
 * guest is then reconciled in a one-time post-hydration effect.
 */
export function serverIdentity(
  serverName: string | null | undefined,
  guest: ServerGuestIdentity,
): UserIdentity {
  if (serverName) return { name: serverName, color: guest.guest_color ?? COLORS[0] }
  if (guest.guest_name) {
    return { name: guest.guest_name, color: guest.guest_color ?? COLORS[0] }
  }
  return { name: 'Anonymous', color: COLORS[0] }
}

/** True when the server already knew the guest identity from the cookie — in
 *  that case there is nothing to reconcile post-hydration (no flicker). */
export function serverKnewGuest(guest: ServerGuestIdentity): boolean {
  return Boolean(guest.guest_name)
}

/** The random localStorage identity — what you are with no chosen name. The
 *  cookie is kept in sync on every read so the NEXT load is server-correct
 *  (the one-time migration for users whose identity predates the cookie). */
function guestIdentity(): UserIdentity {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const identity = JSON.parse(stored) as UserIdentity
      writeGuestCookie(identity)
      return identity
    }
  } catch {
    // storage unavailable — fall through to a fresh identity
  }

  const identity: UserIdentity = {
    name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`,
    color: pick(COLORS),
  }
  persistGuestIdentity(identity)
  return identity
}

/** Persist a guest identity to both localStorage (legacy source of truth) and
 *  the `pruf_guest` cookie (server-readable for first-paint SSR). */
export function persistGuestIdentity(identity: UserIdentity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
  } catch {
    // fine — identity just won't persist to storage
  }
  writeGuestCookie(identity)
}

function writeGuestCookie(identity: UserIdentity): void {
  // Only the fields the server reads — keep it small and stable so a present
  // cookie never disagrees with the localStorage record byte-for-byte.
  setCookie(GUEST_COOKIE, JSON.stringify({ name: identity.name, color: identity.color }))
}

/** Read the stored guest identity without generating one — used by the
 *  document page's post-hydration migration (cookie absent on first load). */
export function storedGuestIdentity(): UserIdentity | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? (JSON.parse(stored) as UserIdentity) : null
  } catch {
    return null
  }
}

/** Sync the `pruf_guest` cookie from localStorage when present, generating a
 *  fresh guest identity (and cookie) when absent. Returns the identity that is
 *  now the server's source of truth for the NEXT load. Safe to call from a
 *  post-hydration effect — never during render. */
export function reconcileGuestCookie(): UserIdentity {
  return guestIdentity()
}
