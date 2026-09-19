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

/** CompoundWriting::Lens#as_props: one reviewer from a pack. */
export interface WritingReviewerPayload {
  /** `<pack name>/<skill name>`. */
  key: string
  name: string
  blurb: string
  /** Colour slot (0-15) mapped to --cw-<slot> custom properties and the cw-<slot>-* highlights. */
  color: number
  origin: 'sidecar' | 'curated' | 'generated'
  skill_path: string
  questions: Array<{ id: string; scope: WritingScope; note: string }>
}

/** WritingPack#as_props for one of the account's subscriptions. */
export interface WritingPackPayload {
  id: number
  name: string
  display_name: string
  description: string | null
  version: string | null
  source_kind: string
  source_locator: string
  source_ref: string | null
  source_sha: string
  short_sha: string
  fetched_at: string | null
  lenses: Array<WritingReviewerPayload & { enabled: boolean }>
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

/** WritingPass::STATUSES, shared by the pass and each reviewer's run. */
export type WritingRunStatus = 'queued' | 'running' | 'finished' | 'failed'

/** WritingPass#as_props. */
export interface WritingPassPayload {
  id: number
  status: WritingRunStatus
  reviewer_keys: string[]
  reviewer_runs: Record<string, { status: WritingRunStatus; error?: string; findings_count?: number; finished_at?: string }>
  /** The lens definitions this pass ran with (its own snapshot). */
  lenses: WritingReviewerPayload[]
  word_count: number
  paragraph_count: number
  /** CompoundWriting::ParagraphDigest of the judged paragraphs (see paragraphDigest). */
  paragraphs_digest: string
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
