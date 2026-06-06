export interface UserIdentity {
  name: string
  color: string
}

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
export function userIdentity(serverName?: string | null): UserIdentity {
  // Render-path callers (useForm initializers) must survive non-browser
  // environments where localStorage doesn't exist.
  if (typeof window === 'undefined') {
    return { name: serverName ?? 'Anonymous', color: COLORS[0] }
  }
  const guest = guestIdentity()
  return serverName ? { ...guest, name: serverName } : guest
}

/** The random localStorage identity — what you are with no chosen name. */
function guestIdentity(): UserIdentity {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored) as UserIdentity
  } catch {
    // storage unavailable — fall through to a fresh identity
  }

  const identity: UserIdentity = {
    name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`,
    color: pick(COLORS),
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
  } catch {
    // fine — identity just won't persist
  }
  return identity
}
