import { useMemo, useState } from 'react'
import { timeAgo } from '../lib/time'
import type { ActivityPayload } from '../pages/documents/show'

const ACTION_GLYPHS: Record<string, string> = {
  suggested: '✦',
  commented: '◆',
  joined: '→',
  left: '←',
  created_document: '+',
  accepted_suggestion: '✓',
  rejected_suggestion: '✕',
  resolved_comment: '✓',
}

const ACTION_LABELS: Record<string, string> = {
  suggested: 'proposed an edit',
  commented: 'commented',
  joined: 'joined the document',
  left: 'signed off',
  created_document: 'created the document',
  accepted_suggestion: 'accepted a suggestion',
  rejected_suggestion: 'rejected a suggestion',
  resolved_comment: 'resolved a comment',
}

const PLURAL_LABELS: Record<string, (n: number) => string> = {
  suggested: (n) => `proposed ${n} edits`,
  commented: (n) => `left ${n} comments`,
  accepted_suggestion: (n) => `accepted ${n} suggestions`,
  rejected_suggestion: (n) => `rejected ${n} suggestions`,
  resolved_comment: (n) => `resolved ${n} comments`,
}

const VISIBLE_GROUPS = 6
const GROUP_WINDOW_MS = 60_000

interface ActivityGroup {
  newest: ActivityPayload
  count: number
  lastAt: number
}

// Consecutive entries by the same actor doing the same thing within a minute
// of each other collapse into one row ("Gemini proposed 3 edits").
function groupActivities(activities: ActivityPayload[]): ActivityGroup[] {
  const groups: ActivityGroup[] = []
  for (const activity of activities) {
    const at = new Date(activity.created_at).getTime()
    const current = groups[groups.length - 1]
    if (
      current &&
      current.newest.actor_name === activity.actor_name &&
      current.newest.action === activity.action &&
      Math.abs(current.lastAt - at) <= GROUP_WINDOW_MS
    ) {
      current.count += 1
      current.lastAt = at
      continue
    }
    groups.push({ newest: activity, count: 1, lastAt: at })
  }
  return groups
}

export function ActivityPanel({ activities }: { activities: ActivityPayload[] }) {
  const [expanded, setExpanded] = useState(false)
  const groups = useMemo(() => groupActivities(activities), [activities])
  const visible = expanded ? groups : groups.slice(0, VISIBLE_GROUPS)
  const hidden = groups.length - VISIBLE_GROUPS

  return (
    <section className="rail-section" aria-label="Activity">
      <header className="rail-heading">
        <h2>Activity</h2>
      </header>
      {activities.length === 0 && (
        <p className="rail-empty">
          Quiet so far. When agents or collaborators act — suggest, comment,
          join — it shows up here live.
        </p>
      )}
      <ul className="activity-list">
        {visible.map((group) => {
          const { newest, count } = group
          const label =
            count > 1
              ? (PLURAL_LABELS[newest.action]?.(count) ??
                `${ACTION_LABELS[newest.action] ?? newest.action} ×${count}`)
              : (ACTION_LABELS[newest.action] ?? newest.action)
          return (
            <li
              key={newest.id}
              className={`activity-row activity-row--${newest.actor_kind}`}
            >
              <span className="activity-glyph">{ACTION_GLYPHS[newest.action] ?? '·'}</span>
              <span className="activity-text">
                <strong>{newest.actor_name}</strong> {label}
                {count === 1 && newest.detail && (
                  <em className="activity-detail"> — {newest.detail}</em>
                )}
              </span>
              <time className="activity-time">{timeAgo(newest.created_at)}</time>
            </li>
          )
        })}
      </ul>
      {hidden > 0 && (
        <button className="activity-expander" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Show fewer' : `Show all (${activities.length})`}
        </button>
      )}
    </section>
  )
}
