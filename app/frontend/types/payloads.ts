/**
 * Wire contracts for the Rails-rendered Inertia props. Each interface
 * mirrors the matching model's `as_props` (app/models/*.rb) — when a
 * serializer changes, this is the one file to diff against.
 */

/** Comment::AUTHOR_KINDS and Document#seed_author_kind (no 'ai' value). */
export type CollaboratorKind = 'human' | 'agent'

/** Suggestion::AUTHOR_KINDS. */
export type AuthorKind = CollaboratorKind | 'ai'

/** Activity.actor_kind: an author kind, or 'system' for automatic actions
 *  (see Suggestion.auto_reject_stale!). Rendered as a CSS class modifier. */
export type ActorKind = AuthorKind | 'system'

/** Suggestion::STATUSES. */
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected'

/** Suggestion#as_props. */
export interface SuggestionPayload {
  id: number
  author_name: string
  author_kind: AuthorKind
  intent: string | null
  body: string
  anchor_text: string | null
  replaces: string | null
  status: SuggestionStatus
  created_at: string
}

/** Comment#as_props. */
export interface CommentPayload {
  id: number
  author_name: string
  author_kind: CollaboratorKind
  body: string
  anchor_text: string | null
  resolved: boolean
  created_at: string
}

/** Activity#as_props. */
export interface ActivityPayload {
  id: number
  actor_name: string
  actor_kind: ActorKind
  action: string
  detail: string | null
  created_at: string
}

/** CompoundWriting::Reviewers::SCOPES. */
export type WritingScope = 'phrase' | 'sentence' | 'paragraph' | 'text'

/** CompoundWriting::Reviewers::Reviewer#as_props. */
export interface WritingReviewerPayload {
  key: string
  name: string
  blurb: string
  /** Colour slot (0-12) mapped to --cw-<slot> custom properties. */
  color: number
  source: string
  questions: Array<{ id: string; scope: WritingScope; note: string }>
}

/** WritingFinding#as_props. Text-scope findings carry null anchors. */
export interface WritingFindingPayload {
  id: number
  reviewer_key: string
  question_id: string
  scope: WritingScope
  paragraph_index: number | null
  paragraph_text: string | null
  quote: string | null
  quote_offset: number | null
  probability: number
  note: string | null
}

/** WritingPass::RUN_STATUSES. */
export type WritingRunStatus = 'queued' | 'running' | 'finished' | 'failed'

/** WritingPass#as_props. */
export interface WritingPassPayload {
  id: number
  status: WritingRunStatus
  reviewer_keys: string[]
  reviewer_runs: Record<string, { status: WritingRunStatus; error?: string; findings_count?: number; finished_at?: string }>
  word_count: number
  paragraph_count: number
  created_at: string
  finished_at: string | null
  findings: WritingFindingPayload[]
}

/** AgentPresence#as_props (status domain: Api::PresencesController). */
export interface AgentPresencePayload {
  id: number
  agent_name: string
  status: 'active' | 'done'
  location_text: string | null
  last_seen_at: string
}

/** Document link access levels (Document#link_access). */
export type LinkAccess = 'edit' | 'comment' | 'view'

/** Document#ownership_props. */
export interface OwnershipPayload {
  claimed: boolean
  claimable: boolean
  owner_name: string | null
  yours: boolean
  link_access: LinkAccess
  editing_locked: boolean
  can_write: boolean
  can_comment: boolean
}
