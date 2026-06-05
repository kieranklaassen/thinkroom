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
}

const MAX_VISIBLE = 4

export function PresenceBar({ humans, agents }: Props) {
  const total = humans.length + agents.length
  if (total === 0) return null

  const visibleHumans = humans.slice(0, MAX_VISIBLE)
  const overflow = total - visibleHumans.length - agents.length

  return (
    <span className="presence-bar" aria-label={`${total} collaborators present`}>
      {agents.map((agent) => (
        <span
          key={`agent-${agent.id}`}
          className="presence-chip presence-chip--agent"
          title={`${agent.agent_name} — agent, working via the API`}
        >
          <span className="presence-agent-glyph">✦</span>
          {agent.agent_name}
        </span>
      ))}
      {visibleHumans.map((human, index) => (
        <span
          key={`human-${index}`}
          className="presence-dot"
          style={{ background: human.color }}
          title={human.name}
        />
      ))}
      {overflow > 0 && <span className="presence-overflow">+{overflow}</span>}
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
