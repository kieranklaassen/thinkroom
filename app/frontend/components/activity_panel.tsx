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

export function ActivityPanel({ activities }: { activities: ActivityPayload[] }) {
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
        {activities.map((activity) => (
          <li
            key={activity.id}
            className={`activity-row activity-row--${activity.actor_kind}`}
          >
            <span className="activity-glyph">{ACTION_GLYPHS[activity.action] ?? '·'}</span>
            <span className="activity-text">
              <strong>{activity.actor_name}</strong>{' '}
              {ACTION_LABELS[activity.action] ?? activity.action}
              {activity.detail && <em className="activity-detail"> — {activity.detail}</em>}
            </span>
            <time className="activity-time">{timeAgo(activity.created_at)}</time>
          </li>
        ))}
      </ul>
    </section>
  )
}
