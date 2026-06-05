# Signals connected editors that document metadata changed (suggestions,
# comments, activity, presence). Clients respond with a partial Inertia
# reload of just that prop — the controller stays the source of truth.
class DocumentMetaChannel < ApplicationCable::Channel
  def subscribed
    document = Document.find_by(slug: params[:slug])
    return reject unless document

    stream_for document
  end

  def self.broadcast_event(document, event)
    broadcast_to(document, { event: event.to_s })
  end
end
