class DocumentsController < InertiaController
  def index
    # Recents are session-scoped: you see the documents you opened, not a
    # global listing of everyone's.
    slugs = Array(session[:recent_slugs])
    docs = Document.where(slug: slugs).index_by(&:slug)
    render inertia: "documents/index", props: {
      recent: slugs.filter_map { |slug| docs[slug] }.map { |d| d.slice(:title, :slug) }
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
      suggestions: -> { document.suggestions.pending.order(:created_at).map(&:as_props) },
      comments: -> { document.comments.order(:created_at).map(&:as_props) },
      activities: -> { document.activities.recent.map(&:as_props) },
      presences: -> { document.agent_presences.active.map(&:as_props) }
    }
  end

  def create
    document = Document.create!(
      title: params[:title].presence || "Untitled",
      seed_markdown: params[:markdown].presence || Document::DEFAULT_SEED
    )
    remember_recent(document)
    redirect_to document_page_path(document.slug), status: :see_other
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
