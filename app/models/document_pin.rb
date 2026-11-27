# A pin keeps a document on the index's Pinned list for one owner: the
# signed-in account, or the guest browser's owner_token when signed out.
# Pins are private bookmarks — any readable document can be pinned, and
# nothing about a pin is visible to the document's owner or other viewers.
class DocumentPin < ApplicationRecord
  MAX_PER_OWNER = 50

  class CapReached < StandardError
    def message = "You can pin up to #{MAX_PER_OWNER} pages."
  end

  belongs_to :document
  belongs_to :user, optional: true

  # Account ownership wins over the browser token, and a blank token never
  # matches — the same rule as Document#owned_by?.
  scope :for_owner, ->(user:, token:) {
    if user
      where(user_id: user.id)
    elsif token.present?
      where(user_id: nil, owner_token: token)
    else
      none
    end
  }

  class << self
    # Idempotent: pinning an already-pinned document returns true without a
    # second row (the partial unique indexes absorb double clicks and races).
    # Returns nil when there is no owner to pin for.
    def pin!(document, user:, token:)
      owner = owner_attributes(user:, token:)
      return if owner.nil?

      pins = for_owner(user:, token:)
      return true if pins.exists?(document_id: document.id)
      raise CapReached if pins.count >= MAX_PER_OWNER

      now = Time.current
      insert_ignoring_conflict(owner.merge(document_id: document.id, created_at: now, updated_at: now))
      true
    end

    def unpin!(document, user:, token:)
      for_owner(user:, token:).where(document_id: document.id).delete_all
    end

    private

    # As insert_all, which writes the values into the statement, with binds.
    def insert_ignoring_conflict(attributes)
      binds = attributes.map do |name, value|
        ActiveRecord::Relation::QueryAttribute.new(name.to_s, value, type_for_attribute(name))
      end
      with_connection do |connection|
        columns = attributes.keys.map { |name| connection.quote_column_name(name) }.join(",")
        values = Array.new(binds.size, "?").join(", ")
        connection.exec_query(<<~SQL.squish, "#{name} Insert", binds)
          INSERT INTO #{quoted_table_name} (#{columns}) VALUES (#{values})
          ON CONFLICT DO NOTHING RETURNING #{connection.quote_column_name(primary_key)}
        SQL
      end
    end

    def owner_attributes(user:, token:)
      if user
        { user_id: user.id, owner_token: nil }
      elsif token.present?
        { user_id: nil, owner_token: token }
      end
    end
  end
end
