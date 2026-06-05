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
  if (total === 0) return null

  const visibleHumans = humans.slice(0, compact ? MAX_VISIBLE_COMPACT : MAX_VISIBLE)
  const overflow = humans.length - visibleHumans.length

  return (
    <span
      className={`presence-bar ${compact ? 'presence-bar--compact' : ''}`}
      aria-label={`${total} collaborators present`}
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

export function AgentsBadge({ agents }: { agents: AgentPresencePayload[] }) {
  if (agents.length === 0) return null
  return (
    <span className="agents-badge" title={agents.map((a) => a.agent_name).join(', ')}>
      Shared with agents · {agents.length} active
    </span>
  )
}
