class DocumentsController < InertiaController
  include DocumentWriteAuthorization
  rate_limit_document_creation

  SIGNED_IN_AUTO_CLAIM_WINDOW = 10.minutes

  # SSR is scoped to the read-only document surfaces — #show (shell, header,
  # static content_html preview) and #index (the landing page) — so their
  # content is on screen at first byte. Both pages are SSR-safe: the live
  # editor is a client-only island (useIsClient), and the landing reads no
  # browser globals at render time (origin is filled post-hydration). Other
  # actions (create, claim, …) stay CSR. The lambda is instance_exec'd per
  # request. Browser-only branches of #show (agent UA / .txt / .json) return
  # before the inertia render, so SSR never touches them.
  inertia_config ssr_enabled: -> { %w[show index].include?(action_name) }

  def index
    now = Time.current
    week_start = now.beginning_of_week
    # Signed-in ownership follows the account across browsers. Guests retain
    # the original permanent-cookie ownership model.
    yours = if current_user
      current_user.documents.order(created_at: :desc).limit(50)
    else
      Document.where(owner_token: owner_token).order(created_at: :desc).limit(50)
    end
    your_slugs = yours.map(&:slug).to_set

    # Recents are session-scoped: you see the documents you opened, not a
    # global listing of everyone's. The mechanism is unchanged — the display
    # just skips docs already shown under Your docs.
    slugs = Array(session[:recent_slugs])
    docs = Document.where(slug: slugs).index_by(&:slug)
    render inertia: "documents/index", props: {
      yours: yours.map do |document|
        index_document_props(document, week_start:, current_year: now.year)
      end,
      # Recent rows carry ownership state so claimable docs can offer an
      # inline claim affordance. Render-time staleness is fine: the claim
      # POST is race-tolerant and the scoped reload reconciles the lists.
      recent: slugs.filter_map { |slug| docs[slug] unless your_slugs.include?(slug) }
                   .map do |d|
                     index_document_props(d, week_start:, current_year: now.year)
                       .merge(d.ownership_props(owner_token, viewer_user: current_user))
                   end
    }
  end

  # The share URL serves two audiences: browsers get the live editor; agents
  # fetching it programmatically (JSON accept, ?format, or a non-browser UA)
  # get a self-describing guide to participating. The editor HTML also embeds
  # the guide invisibly so even a raw text fetch of the page surfaces it.
  def show
    document = Document.find_by!(slug: params[:slug])
    link_preview_request = link_preview_user_agent?
    mode = requested_document_mode(document)

    # Mode URLs express an editing capability. If the current viewer cannot
    # use that capability, send them to the canonical Read URL before the
    # request can affect recents or claim a pending seed. The demo is the one
    # intentionally fixed-mode document: it remains Edit at its established
    # base URL, so alternate demo URLs canonicalize there too.
    if params[:mode].present? &&
       (document.slug == "demo" || !document_mode_available?(document, mode))
      return redirect_to document_page_path(document.slug), status: :see_other
    end

    if request.format.json? || params[:format] == "json"
      return render json: AgentGuide.state(document, request.base_url)
    end
    if params[:format] == "txt" || (agent_user_agent? && !link_preview_request)
      return render plain: AgentGuide.text(document, request.base_url)
    end

    auto_claim_recent_document(document, link_preview_request:)
    remember_recent(document) unless link_preview_request
    @agent_guide = AgentGuide.text(document, request.base_url)
    @open_graph = document_open_graph(document)

    # Claim the seed at page-render time so a fresh document paints its
    # template from props instead of waiting for the WebSocket round-trip.
    # Only the HTML editor path may claim — agent/JSON fetches above never
    # reach here, so a programmatic read can't burn the claim. Partial
    # reloads and prefetch-shaped requests are also excluded: only an
    # initial render mounts an editor that will actually apply the grant,
    # and a burned grant blocks the channel fallback for SEED_CLAIM_TIMEOUT.
    seed_granted = initial_render? && !prefetch_request? && !link_preview_request && document.try_claim_seed

    render inertia: "documents/show", props: {
      # Cookie-backed UI prefs and the path-derived mode are both available to
      # SSR, so the first paint and hydration agree without a client-side flip.
      # Mode deliberately comes from the URL rather than a browser preference:
      # links, reloads, and Inertia history are now its source of truth.
      ui: ui_prefs(mode:),
      document: document.slice(:id, :slug, :title, :content_format).merge(
        seed_content: document.seed_content,
        seed_granted: seed_granted,
        seed_author_kind: document.seed_author_kind,
        seed_author_name: document.seed_author_name,
        has_state: document.yjs_state.present?,
        yjs_state_b64: (Base64.strict_encode64(document.yjs_state) if document.yjs_state.present?),
        # Server-rendered prose for an instant first paint; the live editor
        # swaps in over it once Milkdown binds the hydrated Yjs state.
        content_html: document.preview_html,
        # First-H1 title derived on the server so the header reads correctly on
        # first paint, before the editor mounts and derives the same title.
        display_title: document.display_title,
        **(document.content_format == "markdown" ? { seed_markdown: document.seed_content } : {})
      ),
      # Ownership rides its own lazy prop so claim events reload cheaply —
      # never re-shipping the Yjs state embedded in the document prop above.
      ownership: -> { document.ownership_props(owner_token, viewer_user: current_user) },
      suggestions: -> { document.suggestions.pending.order(:created_at).map(&:as_props) },
      comments: -> { document.comments.order(:created_at).map(&:as_props) },
      activities: -> { document.activities.recent.map(&:as_props) },
      presences: -> { document.agent_presences.active.map(&:as_props) }
    }
  end

  def create
    # UI-created docs are owned by their creator from the same INSERT — a UI
    # doc never exists momentarily unclaimed, and no claim activity is logged
    # (the doc was never up for grabs). Browser-created documents are always
    # portable Markdown; agents can create typed HTML documents through the API.
    if params.key?(:content) && params.key?(:markdown)
      return redirect_to root_path,
                         inertia: { errors: { content: "Send content or legacy markdown, not both" } }
    end

    raw_content = params[:content].presence || params[:markdown].presence
    if raw_content.to_s.bytesize > Document::MAX_CONTENT_BYTES
      return redirect_to root_path,
                         inertia: { errors: { content: "Document content is too long" } }
    end
    source = raw_content || Document::DEFAULT_SEED

    creator_name = current_user&.name ||
      Document.normalize_owner_name(preferred_name(params[:name], fallback: nil))
    ownership = current_user ? { user: current_user } : { owner_token: owner_token }
    document = Document.create!(
      title: params[:title].presence || "Untitled",
      content_format: "markdown",
      seed_content: source,
      owner_name: creator_name,
      seed_author_kind: "human",
      seed_author_name: creator_name,
      claimed_at: Time.current,
      **ownership
    )
    remember_recent(document)
    redirect_to document_mode_path(document.slug, "edit"), status: :see_other
  end

  # Explicit, deliberate claim — a button click, never a GET side effect, so
  # prefetchers and unfurlers can't claim. First claim wins atomically.
  def claim
    document = Document.find_by!(slug: params[:slug])
    document.claim!(
      token: owner_token,
      user: current_user,
      name: preferred_name(params[:name], fallback: nil)
    )
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

  def update_tags
    document = Document.find_by!(slug: params[:slug])
    unless document.owned_by?(owner_token, user: current_user)
      return redirect_back fallback_location: root_path,
                           inertia: { errors: { tags: "Only the owner can organize this document" } }
    end

    tags = params[:tags]
    unless tags.is_a?(Array)
      return redirect_back fallback_location: root_path,
                           inertia: { errors: { tags: "Tags must be a list" } }
    end

    if document.update(tags:)
      redirect_back fallback_location: root_path, status: :see_other
    else
      redirect_back fallback_location: root_path,
                    inertia: { errors: { tags: document.errors[:tags].to_sentence } }
    end
  rescue ActiveRecord::RecordNotFound
    redirect_to root_path, status: :see_other
  end

  LOCK_VALUES = {
    true => true, false => false,
    "true" => true, "false" => false,
    "1" => true, "0" => false,
    1 => true, 0 => false
  }.freeze

  def update_link_access
    document = Document.find_by!(slug: params[:slug])
    access = params[:access].to_s
    unless Document::LINK_ACCESS_LEVELS.include?(access)
      return redirect_back fallback_location: document_page_path(document.slug), status: :see_other,
                           inertia: { errors: { link_access: "Choose Can edit, Can comment, or Can view" } }
    end

    document.set_link_access!(
      access:,
      token: owner_token,
      user: current_user
    )
    redirect_back fallback_location: document_page_path(document.slug), status: :see_other
  rescue Document::NotOwnerError
    redirect_back fallback_location: document_page_path(params[:slug]), status: :see_other,
                  inertia: { errors: { link_access: "Only the owner can change link access" } }
  rescue ActiveRecord::RecordNotFound
    redirect_to root_path, status: :see_other
  end

  def update_editing_lock
    document = Document.find_by!(slug: params[:slug])
    raw_locked = params[:locked]
    unless LOCK_VALUES.key?(raw_locked)
      return redirect_back fallback_location: document_page_path(document.slug), status: :see_other,
                           inertia: { errors: { editing_lock: "Choose whether others can edit" } }
    end

    document.set_editing_locked!(
      locked: LOCK_VALUES.fetch(raw_locked),
      token: owner_token,
      user: current_user
    )
    redirect_back fallback_location: document_page_path(document.slug), status: :see_other
  rescue Document::NotOwnerError
    redirect_back fallback_location: document_page_path(params[:slug]), status: :see_other,
                  inertia: { errors: { editing_lock: "Only the owner can change editing access" } }
  rescue ActiveRecord::RecordNotFound
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

    unless document.owned_by?(owner_token, user: current_user)
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

  # Editor clients debounce-push a derived snapshot { content, spans } so the
  # Agent API can read document state without a Yjs client.
  MAX_SNAPSHOT_BYTES = 2.megabytes
  MAX_STATE_VECTOR_BYTES = 64.kilobytes
  MAX_SYNC_UPDATE_BYTES = 2.megabytes
  MAX_SNAPSHOT_SPANS = 2_000
  MAX_SNAPSHOT_SPAN_TEXT = 280
  PROVENANCE_KINDS = %w[human ai].freeze
  PROVENANCE_STATES = %w[verbatim pending reviewed endorsed].freeze

  def snapshot
    document = Document.find_by!(slug: params[:slug])
    @write_document = document
    document.assert_write_access!(token: owner_token, user: current_user)
    if params.key?(:content) && params.key?(:markdown)
      return render json: { error: "Send content or legacy markdown, not both." },
                    status: :unprocessable_entity
    end
    if document.html? && params.key?(:markdown)
      return render json: { error: "HTML snapshots must use the content field." },
                    status: :unprocessable_entity
    end
    if document.html? && params[:state_vector].blank?
      return render json: { error: "HTML snapshots require a Yjs state vector." },
                    status: :unprocessable_entity
    end
    content = (params.key?(:content) ? params[:content] : params[:markdown]).to_s
    return head :content_too_large if content.bytesize > MAX_SNAPSHOT_BYTES
    state_vector = params[:state_vector].to_s
    return head :content_too_large if state_vector.bytesize > MAX_STATE_VECTOR_BYTES

    normalization = document.html? ? HtmlDocumentSanitizer.snapshot(content) : nil
    content = normalization.content if normalization

    spans = sanitize_snapshot_spans(params[:spans])
    previous_title = document.title
    title = DocumentTitle.call(format: document.content_format, content:) || previous_title

    persisted = YjsPersistence.persist_snapshot(
      document,
      state_vector_b64: state_vector.presence,
      content:,
      spans:,
      title:,
      token: owner_token,
      user: current_user
    )
    return render json: { error: "Snapshot is stale; retry from current document state." },
                  status: :conflict unless persisted

    DocumentAsset.claim_from_html!(document:, source: content) if document.html?
    broadcast_title(document) if title != previous_title
    render json: { normalized: normalization&.changed? || false }
  end

  # Discrete editor actions (currently task-checkbox toggles) also send their
  # incremental Yjs diff over a keepalive HTTP request. A page reload can close
  # Action Cable before its frame reaches the server; this idempotent fallback
  # makes the same CRDT update durable and relays it to any connected clients.
  def sync_update
    document = Document.find_by!(slug: params[:slug])
    @write_document = document
    document.assert_write_access!(token: owner_token, user: current_user)
    update = params[:update].to_s
    decoded = Base64.strict_decode64(update)
    return head :content_too_large if decoded.bytesize > MAX_SYNC_UPDATE_BYTES

    YjsPersistence.merge(document, update, token: owner_token, user: current_user)
    SyncChannel.broadcast_to(document, {
      type: "update",
      update:,
      cid: params[:cid].to_s.presence || "http-sync"
    })

    if params.key?(:content)
      content = params[:content].to_s
      return head :content_too_large if content.bytesize > MAX_SNAPSHOT_BYTES

      state_vector = params[:state_vector].to_s
      return render json: { error: "A state vector is required with snapshot content." },
                    status: :unprocessable_entity if state_vector.blank?
      return head :content_too_large if state_vector.bytesize > MAX_STATE_VECTOR_BYTES

      normalization = document.html? ? HtmlDocumentSanitizer.snapshot(content) : nil
      content = normalization.content if normalization
      spans = sanitize_snapshot_spans(params[:spans])
      previous_title = document.title
      title = DocumentTitle.call(format: document.content_format, content:) || previous_title
      persisted = YjsPersistence.persist_snapshot(
        document,
        state_vector_b64: state_vector,
        content:,
        spans:,
        title:,
        token: owner_token,
        user: current_user
      )
      return render json: { error: "Snapshot is stale; retry from current document state." },
                    status: :conflict unless persisted

      DocumentAsset.claim_from_html!(document:, source: content) if document.html?
      broadcast_title(document) if title != previous_title
    end

    head :no_content
  rescue ArgumentError
    render json: { error: "Invalid Yjs update." }, status: :unprocessable_entity
  end

  private

  def broadcast_title(document)
    DocumentMetaChannel.broadcast_event(document, :title, title: document.title)
  end

  def index_document_props(document, week_start:, current_year:)
    created_at = document.created_at.in_time_zone
    created_label = if created_at.year == current_year
      created_at.strftime("%b %-d")
    else
      created_at.strftime("%b %-d, %Y")
    end
    {
      title: document.title,
      slug: document.slug,
      tags: document.tags,
      created_at: created_at.iso8601,
      created_label:,
      age_group: created_at >= week_start ? "this_week" : "earlier"
    }
  end

  def sanitize_snapshot_spans(raw_spans)
    Array(raw_spans).first(MAX_SNAPSHOT_SPANS).filter_map do |span|
      next unless span.respond_to?(:permit)

      values = span.permit(:kind, :author, :state, :chars, :text).to_h
      kind = values["kind"].to_s
      state = values["state"].to_s
      chars = Integer(values["chars"], exception: false)
      next unless PROVENANCE_KINDS.include?(kind)
      next unless PROVENANCE_STATES.include?(state)
      next unless chars&.between?(0, MAX_SNAPSHOT_BYTES)

      {
        "kind" => kind,
        "author" => Document.normalize_display_name(values["author"]) || "",
        "state" => state,
        "chars" => chars,
        "text" => values["text"].to_s.first(MAX_SNAPSHOT_SPAN_TEXT)
      }
    end
  end

  def remember_recent(document)
    session[:recent_slugs] = ([ document.slug ] + Array(session[:recent_slugs])).uniq.first(12)
  end

  # Cookie-backed UI prefs, read server-side so SSR's first paint matches the
  # user's stored panel/focus/width (no flip). Mode is path-derived and supplied
  # by #show. Cookies are "1"/"0" flags plus a clamped pixel width.
  MIN_DOCUMENT_WIDTH = 576
  MAX_DOCUMENT_WIDTH = 1120
  LINK_PREVIEW_USER_AGENTS = /(?:
    facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot-linkexpanding|
    discordbot|whatsapp|telegrambot|googlebot|bingbot|pinterestbot|embedly|
    iframely|opengraph
  )/ix

  def requested_document_mode(document)
    return "edit" if document.slug == "demo"

    params[:mode].presence || "read"
  end

  def document_mode_available?(document, mode)
    if mode == "comment"
      document.commentable_by?(owner_token, user: current_user)
    else
      document.writable_by?(owner_token, user: current_user)
    end
  end

  def ui_prefs(mode:)
    document_width = Integer(cookies[:pruf_width], exception: false)
    {
      panel_open: cookies[:pruf_panel] != "0",
      focus_mode: cookies[:pruf_focus] == "1",
      mode:,
      document_width: document_width&.clamp(MIN_DOCUMENT_WIDTH, MAX_DOCUMENT_WIDTH)
    }
  end

  def document_open_graph(document)
    preview = DocumentSocialPreview.new(document)
    {
      title: preview.title,
      page_title: preview.page_title,
      description: preview.description,
      url: document_page_url(document.slug),
      image_url: document_og_image_url(
        document.slug,
        v: DocumentOgImage.url_version(document)
      ),
      image_alt: "Thinkroom shared document preview for “#{preview.title}” with an Open document button."
    }
  end

  def link_preview_user_agent?
    request.user_agent.to_s.match?(LINK_PREVIEW_USER_AGENTS)
  end

  # A freshly agent-created handoff is overwhelmingly likely to belong to the
  # authenticated person who opens it. Keep this GET-side convenience narrow:
  # only a real, full browser navigation may claim, and the model's conditional
  # update remains the authority if another owner wins concurrently.
  def auto_claim_recent_document(document, link_preview_request:)
    user = current_user
    return unless user && request.get? && initial_render?
    return if link_preview_request || prefetch_request?
    return unless document.claimable?
    return if document.created_at < SIGNED_IN_AUTO_CLAIM_WINDOW.ago

    document.claim!(token: owner_token, user:, name: user.name)
  rescue Document::ClaimRaceError
    document.reload
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
