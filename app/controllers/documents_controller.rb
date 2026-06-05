class DocumentsController < InertiaController
  def index
    # Your docs: claimed by this browser's ownership token, newest first.
    yours = Document.where(owner_token: owner_token).order(created_at: :desc).limit(50)
    your_slugs = yours.map(&:slug).to_set

    # Recents are session-scoped: you see the documents you opened, not a
    # global listing of everyone's. The mechanism is unchanged — the display
    # just skips docs already shown under Your docs.
    slugs = Array(session[:recent_slugs])
    docs = Document.where(slug: slugs).index_by(&:slug)
    render inertia: "documents/index", props: {
      yours: yours.map { |d| d.slice(:title, :slug) },
      recent: slugs.filter_map { |slug| your_slugs.include?(slug) ? nil : docs[slug] }
                   .map { |d| d.slice(:title, :slug) }
    }
  end

  # The share URL serves two audiences: browsers get the live editor; agents
  # fetching it programmatically (JSON accept, ?format, or a non-browser UA)
  # get a self-describing guide to participating. The editor HTML also embeds
  # the guide invisibly so even a raw text fetch of the page surfaces it.
  def show
    document = Document.find_by!(slug: params[:slug])

    if request.format.json? || params[:format] == "json"
      return render json: AgentGuide.state(document, request.base_url)
    end
    if params[:format] == "txt" || agent_user_agent?
      return render plain: AgentGuide.text(document, request.base_url)
    end

    remember_recent(document)
    @agent_guide = AgentGuide.text(document, request.base_url)

    render inertia: "documents/show", props: {
      document: document.slice(:id, :slug, :title).merge(
        seed_markdown: document.seed_markdown,
        has_state: document.yjs_state.present?,
        yjs_state_b64: (Base64.strict_encode64(document.yjs_state) if document.yjs_state.present?)
      ),
      # Ownership rides its own lazy prop so claim events reload cheaply —
      # never re-shipping the Yjs state embedded in the document prop above.
      ownership: -> { document.ownership_props(owner_token) },
      suggestions: -> { document.suggestions.pending.order(:created_at).map(&:as_props) },
      comments: -> { document.comments.order(:created_at).map(&:as_props) },
      activities: -> { document.activities.recent.map(&:as_props) },
      presences: -> { document.agent_presences.active.map(&:as_props) }
    }
  end

  def create
    # UI-created docs are owned by their creator from the same INSERT — a UI
    # doc never exists momentarily unclaimed, and no claim activity is logged
    # (the doc was never up for grabs).
    document = Document.create!(
      title: params[:title].presence || "Untitled",
      seed_markdown: params[:markdown].presence || Document::DEFAULT_SEED,
      owner_token: owner_token,
      owner_name: params[:name].to_s.strip.first(255).presence || "Anonymous",
      claimed_at: Time.current
    )
    remember_recent(document)
    redirect_to document_page_path(document.slug), status: :see_other
  end

  # Explicit, deliberate claim — a button click, never a GET side effect, so
  # prefetchers and unfurlers can't claim. First claim wins atomically.
  def claim
    document = Document.find_by!(slug: params[:slug])
    document.claim!(token: owner_token, name: params[:name])
    redirect_back fallback_location: document_page_path(document.slug), status: :see_other
  rescue Document::UnclaimableError
    redirect_back fallback_location: document_page_path(document.slug), status: :see_other,
                  inertia: { errors: { claim: "This document cannot be claimed" } }
  rescue ActiveRecord::RecordInvalid
    redirect_back fallback_location: document_page_path(document.slug), status: :see_other,
                  inertia: { errors: { claim: "already claimed" } }
  end

  # Owners only. The broadcast goes out before destroy so connected editors
  # route home instead of 404ing; already-gone docs redirect home (idempotent
  # — a second tab's delete shouldn't error).
  def destroy
    document = Document.find_by(slug: params[:slug])
    return redirect_to root_path, status: :see_other if document.nil?

    unless document.owned_by?(owner_token)
      return redirect_back fallback_location: document_page_path(document.slug), status: :see_other,
                           inertia: { errors: { document: "Only the owner can delete this document" } }
    end

    DocumentMetaChannel.broadcast_event(document, :document_deleted)
    document.destroy!
    redirect_to root_path, status: :see_other
  end

  # Editor clients debounce-push a derived snapshot { markdown, spans } so the
  # Agent API can read document state without a Yjs client.
  MAX_SNAPSHOT_BYTES = 2.megabytes

  def snapshot
    document = Document.find_by!(slug: params[:slug])
    markdown = params[:markdown].to_s
    return head :payload_too_large if markdown.bytesize > MAX_SNAPSHOT_BYTES

    spans = Array(params[:spans]).first(2_000).map do |span|
      next unless span.respond_to?(:permit)

      span.permit(:kind, :author, :state, :chars, :text).to_h
    end.compact

    document.update!(content_markdown: markdown, provenance_spans: spans)
    head :ok
  end

  private

  def remember_recent(document)
    session[:recent_slugs] = ([document.slug] + Array(session[:recent_slugs])).uniq.first(12)
  end

  # Browsers identify as Mozilla/...; curl, wget, httpx, ruby, etc. don't.
  def agent_user_agent?
    ua = request.user_agent.to_s
    ua.blank? || !ua.include?("Mozilla")
  end
end
