class DocumentsController < InertiaController
  def index
    render inertia: "documents/index", props: {
      recent: Document.order(updated_at: :desc).limit(8).map { |d| d.slice(:title, :slug) }
    }
  end

  def show
    document = Document.find_by!(slug: params[:slug])

    render inertia: "documents/show", props: {
      document: document.slice(:id, :slug, :title).merge(
        seed_markdown: document.seed_markdown,
        has_state: document.yjs_state.present?
      ),
      summary: document.provenance_summary
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
end
