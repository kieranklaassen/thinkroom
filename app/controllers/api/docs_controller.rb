module Api
  class DocsController < BaseController
    # POST /api/docs — create a document from markdown, get back its slug.
    def create
      markdown = params[:markdown].presence
      # Authorship is recorded only for agent-supplied markdown: the seeding
      # client attributes that text as AI prose. DEFAULT_SEED boilerplate
      # stays unattributed — placeholder text must never be claimed as AI.
      agent_authored = current_agent.present? && markdown.present?
      doc = Document.create!(
        title: params[:title].presence || "Untitled",
        seed_markdown: markdown || Document::DEFAULT_SEED,
        seed_author_kind: agent_authored ? "agent" : nil,
        seed_author_name: agent_authored ? Document.normalize_display_name(current_agent) : nil
      )

      if current_agent
        Activity.log!(
          document: doc, actor_name: current_agent, actor_kind: "agent",
          action: "created_document", detail: doc.title
        )
      end

      render json: {
        slug: doc.slug,
        title: doc.title,
        share_url: document_page_url(doc.slug),
        note: "This document is unclaimed. The first person to open the share URL in a browser can claim it — claiming grants them ownership (including delete).",
        api: AgentGuide.endpoints(doc, request.base_url)
      }, status: :created
    end

    # GET /api/docs/:slug — the document's full live state.
    def show
      touch_presence
      render json: AgentGuide.state(document, request.base_url)
    end
  end
end
