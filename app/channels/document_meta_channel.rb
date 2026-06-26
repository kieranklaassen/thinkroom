# Signals connected editors that document metadata changed (suggestions,
# comments, activity, presence). Clients respond with a partial Inertia
# reload of just that prop — the controller stays the source of truth.
class DocumentMetaChannel < ApplicationCable::Channel
  def subscribed
    document = Document.find_by(slug: params[:slug])
    return reject unless document

    stream_for document
    transmit({ event: "version", version: ENV.fetch("KAMAL_VERSION", "development") })
  end

  def self.broadcast_event(document, event, **payload)
    broadcast_to(document, { event: event.to_s, **payload })
  end

  def self.broadcast_event_after_commit(document, event, **payload)
    ActiveRecord.after_all_transactions_commit do
      broadcast_event(document, event, **payload)
    end
  end
end
