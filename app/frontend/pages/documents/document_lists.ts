import type { OwnershipPayload } from '../../types/payloads'

type AgeGroup = 'this_week' | 'earlier'

export type DocLink = {
  title: string
  slug: string
  tags: string[]
  created_at: string
  created_label: string
  age_group: AgeGroup
}

export type RecentDoc = DocLink & OwnershipPayload
export type PinnedDoc = RecentDoc & { pinned_at: string }

// Every list that shows a star or a Pinned row reloads together, so star
// state (derived from `pinned`) and Pinned meta never drift apart.
export const LIST_PROPS = ['pinned', 'yours', 'yours_count', 'archived_count', 'recent', 'continue_reading', 'errors']
