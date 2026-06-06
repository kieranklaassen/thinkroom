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
      # Recent rows carry ownership state so claimable docs can offer an
      # inline claim affordance. Render-time staleness is fine: the claim
      # POST is race-tolerant and the scoped reload reconciles the lists.
      recent: slugs.filter_map { |slug| docs[slug] unless your_slugs.include?(slug) }
                   .map { |d| d.slice(:title, :slug).merge(d.ownership_props(owner_token)) }
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

    # Claim the seed at page-render time so a fresh document paints its
    # template from props instead of waiting for the WebSocket round-trip.
    # Only the HTML editor path may claim — agent/JSON fetches above never
    # reach here, so a programmatic read can't burn the claim. Partial
    # reloads and prefetch-shaped requests are also excluded: only an
    # initial render mounts an editor that will actually apply the grant,
    # and a burned grant blocks the channel fallback for SEED_CLAIM_TIMEOUT.
    seed_granted = initial_render? && !prefetch_request? && document.try_claim_seed

    render inertia: "documents/show", props: {
      document: document.slice(:id, :slug, :title).merge(
        seed_markdown: document.seed_markdown,
        seed_granted: seed_granted,
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
      owner_name: Document.normalize_owner_name(preferred_name(params[:name], fallback: nil)),
      claimed_at: Time.current
    )
    remember_recent(document)
    redirect_to document_page_path(document.slug), status: :see_other
  end

  # Explicit, deliberate claim — a button click, never a GET side effect, so
  # prefetchers and unfurlers can't claim. First claim wins atomically.
  def claim
    document = Document.find_by!(slug: params[:slug])
    document.claim!(token: owner_token, name: preferred_name(params[:name], fallback: nil))
    redirect_back fallback_location: document_page_path(document.slug), status: :see_other
  rescue Document::UnclaimableError
    redirect_back fallback_location: document_page_path(document.slug), status: :see_other,
                  inertia: { errors: { claim: "This document cannot be claimed" } }
  rescue Document::ClaimRaceError
    redirect_back fallback_location: document_page_path(document.slug), status: :see_other,
                  inertia: { errors: { claim: "already claimed" } }
  rescue ActiveRecord::RecordNotFound
    # The doc was deleted while the claim was in flight — go home cleanly
    # instead of popping a 404 modal over a dead editor.
    redirect_to root_path, status: :see_other
  end

  # Owners only. The broadcast goes out after a successful destroy — the
  # stream name derives from the record's retained id, so it still reaches
  # every subscriber, and clients are only evicted when the delete actually
  # committed. Already-gone docs redirect home (idempotent — a second tab's
  # delete shouldn't error).
  def destroy
    document = Document.find_by(slug: params[:slug])
    return redirect_to root_path, status: :see_other if document.nil?

    unless document.owned_by?(owner_token)
      return redirect_back fallback_location: document_page_path(document.slug), status: :see_other,
                           inertia: { errors: { document: "Only the owner can delete this document" } }
    end

    document.destroy!
    DocumentMetaChannel.broadcast_event(document, :document_deleted)
    redirect_to root_path, status: :see_other
  rescue ActiveRecord::RecordNotDestroyed, ActiveRecord::StatementInvalid
    redirect_back fallback_location: document_page_path(params[:slug]), status: :see_other,
                  inertia: { errors: { document: "Delete failed — please try again" } }
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
    session[:recent_slugs] = ([ document.slug ] + Array(session[:recent_slugs])).uniq.first(12)
  end

  # Browsers identify as Mozilla/...; curl, wget, httpx, ruby, etc. don't.
  def agent_user_agent?
    ua = request.user_agent.to_s
    ua.blank? || !ua.include?("Mozilla")
  end

  # Inertia partial reloads (presence polls, ownership events, …) re-run
  # this action but never remount the editor — they must not touch the
  # seed claim.
  def initial_render?
    request.headers["X-Inertia-Partial-Component"].blank?
  end

  # Link prefetchers fetch pages no editor will mount in. Sec-Purpose is
  # the standard header; Purpose is the legacy spelling still sent by
  # some browsers and proxies.
  def prefetch_request?
    request.headers["Sec-Purpose"].to_s.include?("prefetch") ||
      request.headers["Purpose"].to_s == "prefetch"
  end
end
