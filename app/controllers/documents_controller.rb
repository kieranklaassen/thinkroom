class DocumentsController < InertiaController
  def index
    render inertia: "documents/index", props: {
      recent: Document.order(updated_at: :desc).limit(8).map { |d| d.slice(:title, :slug) }
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

    @agent_guide = AgentGuide.text(document, request.base_url)

    render inertia: "documents/show", props: {
      document: document.slice(:id, :slug, :title).merge(
        seed_markdown: document.seed_markdown,
        has_state: document.yjs_state.present?
      ),
      summary: document.provenance_summary,
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
    redirect_to document_page_path(document.slug)
  end

  # Editor clients debounce-push a derived snapshot { markdown, spans } so the
  # Agent API can read document state without a Yjs client.
  def snapshot
    document = Document.find_by!(slug: params[:slug])
    document.update!(
      content_markdown: params[:markdown].to_s,
      provenance_spans: params[:spans] || []
    )
    head :ok
  end

  private

  # Browsers identify as Mozilla/...; curl, wget, httpx, ruby, etc. don't.
  def agent_user_agent?
    ua = request.user_agent.to_s
    ua.blank? || !ua.include?("Mozilla")
  end
end
