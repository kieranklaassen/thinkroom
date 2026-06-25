export interface AccountPayload {
  id: number
  name: string
  email: string
}

export interface ViewerPayload {
  name: string | null
  guest: boolean
  account: AccountPayload | null
  // The browser's random guest identity, cookie-backed so the server can
  // render the real name + color at first paint (no Anonymous→name flash).
  // Null when no guest cookie is set (first-ever visit, or signed in).
  guest_name: string | null
  guest_color: string | null
}
