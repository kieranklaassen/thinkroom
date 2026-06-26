import { Link } from '@inertiajs/react'
import type { ViewerPayload } from '../types/viewer'

interface Props {
  viewer: ViewerPayload
}

export function AccountControl({ viewer }: Props) {
  if (!viewer.account) {
    return (
      <Link href="/login?return_to=%2F" className="account-control account-control--guest">
        Sign in
      </Link>
    )
  }

  return (
    <div className="account-control account-control--signed-in">
      <span title={viewer.account.email}>{viewer.account.name}</span>
      <Link href="/logout" method="delete" as="button">
        Sign out
      </Link>
    </div>
  )
}
