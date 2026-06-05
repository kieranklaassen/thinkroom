# An agent's live presence in a document. Agents announce themselves over the
# API; every authenticated API call refreshes last_seen_at. The UI shows a
# labeled pseudo-cursor and presence chip while a presence is active.
class AgentPresence < ApplicationRecord
  ACTIVE_WINDOW = 90.seconds

  belongs_to :document

  validates :agent_name, presence: true, uniqueness: { scope: :document_id }

  scope :active, -> { where(status: "active").where(last_seen_at: ACTIVE_WINDOW.ago..) }

  # Returns [presence, newly_arrived?]
  def self.touch!(document:, agent_name:, status: "active", location_text: nil)
    presence = find_or_initialize_by(document:, agent_name:)
    newly_arrived = presence.new_record? ||
                    presence.status != "active" ||
                    presence.last_seen_at < ACTIVE_WINDOW.ago

    presence.status = status
    presence.location_text = location_text if location_text
    presence.last_seen_at = Time.current
    presence.save!

    DocumentMetaChannel.broadcast_event(document, :presences)
    [presence, newly_arrived && status == "active"]
  end

  def as_props
    slice(:id, :agent_name, :status, :location_text)
      .merge(last_seen_at: last_seen_at.iso8601)
  end
end
