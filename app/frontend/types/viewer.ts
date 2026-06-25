export interface AccountPayload {
  id: number
  name: string
  email: string
}

export interface ViewerPayload {
  name: string | null
  guest: boolean
  account: AccountPayload | null
}
