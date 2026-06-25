import type { UserIdentity } from '../editor/identity'

export interface AgentPresencePayload {
  id: number
  agent_name: string
  status: string
  location_text: string | null
  last_seen_at: string
}

interface Props {
  humans: UserIdentity[]
  agents: AgentPresencePayload[]
  /** Mobile header: 24px avatars, max 3 visible. */
  compact?: boolean
}

const MAX_VISIBLE = 5
const MAX_VISIBLE_COMPACT = 3

/** 1–2 letter initials from a display name, e.g. "Quiet Falcon" → "QF". */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')

export function PresenceBar({ humans, agents, compact = false }: Props) {
  const total = humans.length + agents.length

  const visibleHumans = humans.slice(0, compact ? MAX_VISIBLE_COMPACT : MAX_VISIBLE)
  const overflow = humans.length - visibleHumans.length

  // Always render the container — even with 0 collaborators — so its reserved
  // lane (a min-width in render-blocking CSS, scoped to .presence-bar) holds
  // the header's layout stable. Human peers arrive over the websocket after
  // first paint; they fade in WITHIN this lane instead of pushing the
  // Edit/Share/⋯ controls. Empty is visually blank but occupies the lane.
  return (
    <span
      className={`presence-bar ${compact ? 'presence-bar--compact' : ''}`}
      data-empty={total === 0 ? '' : undefined}
      aria-label={total === 0 ? undefined : `${total} collaborators present`}
      aria-hidden={total === 0 ? true : undefined}
    >
      {agents.map((agent) => (
        <span
          key={`agent-${agent.id}`}
          className="presence-agent"
          title={`${agent.agent_name} — agent, working via the API`}
        >
          <span className="presence-avatar presence-avatar--agent" aria-hidden>
            ✦
          </span>
          <span className="presence-agent-name">{agent.agent_name}</span>
        </span>
      ))}
      <span className="presence-stack">
        {visibleHumans.map((human, index) => (
          <span
            key={`human-${index}`}
            className="presence-avatar"
            style={{ background: human.color }}
            title={human.name}
          >
            {initials(human.name)}
          </span>
        ))}
        {overflow > 0 && (
          <span className="presence-avatar presence-overflow" title={`${overflow} more`}>
            +{overflow}
          </span>
        )}
      </span>
      {total > 1 && <span className="presence-count">{total} here</span>}
    </span>
  )
}
