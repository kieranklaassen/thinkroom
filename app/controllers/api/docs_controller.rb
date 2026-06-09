module Api
  class DocsController < BaseController
    # POST /api/docs — create a typed source document, get back its slug.
    def create
      if params.key?(:content) && params.key?(:markdown)
        return render json: { error: "Send content or legacy markdown, not both." },
                      status: :unprocessable_entity
      end

      legacy_markdown = params[:markdown].presence
      requested_format = request.request_parameters["format"].presence
      format = requested_format || "markdown"
      if legacy_markdown && format != "markdown"
        return render json: { error: "The markdown field can only create Markdown documents." },
                      status: :unprocessable_entity
      end
      content = params[:content].presence || legacy_markdown
      if requested_format && content.blank?
        return render json: { error: "content is required when format is provided." },
                      status: :unprocessable_entity
      end
      unless Document::CONTENT_FORMATS.include?(format)
        return render json: { error: "format must be markdown or html." },
                      status: :unprocessable_entity
      end
      if content.to_s.bytesize > Document::MAX_CONTENT_BYTES
        return render json: {
          error: "content is too long.",
          max_bytes: Document::MAX_CONTENT_BYTES
        }, status: :content_too_large
      end

      normalization = format == "html" ? HtmlDocumentSanitizer.external(content) : nil
      source = normalization&.content || content || Document::DEFAULT_SEED
      # Authorship is recorded only for agent-supplied source: the seeding
      # client attributes that text as AI prose. DEFAULT_SEED boilerplate
      # stays unattributed — placeholder text must never be claimed as AI.
      # Gate on the normalized name so a whitespace-only header can never
      # produce kind "agent" with a blank author.
      agent_name = Document.normalize_display_name(current_agent)
      agent_authored = agent_name.present? && content.present?
      doc = Document.create!(
        title: params[:title].presence || "Untitled",
        content_format: format,
        seed_content: source,
        seed_author_kind: agent_authored ? "agent" : nil,
        seed_author_name: agent_authored ? agent_name : nil
      )
      DocumentAsset.claim_from_html!(document: doc, source:) if doc.html?

      if current_agent
        Activity.log!(
          document: doc, actor_name: current_agent, actor_kind: "agent",
          action: "created_document", detail: doc.title
        )
      end

      response = {
        slug: doc.slug,
        title: doc.title,
        share_url: document_page_url(doc.slug),
        content_format: doc.content_format,
        content: doc.seed_content,
        plain_text: doc.plain_text,
        normalized: normalization&.changed? || false,
        warning: ("Unsupported HTML was removed or normalized." if normalization&.changed?),
        note: "This document is unclaimed. The first person to open the share URL in a browser can claim it — claiming grants them ownership (including delete).",
        content_contract: AgentGuide.content_contract(doc.content_format, request.base_url),
        api: AgentGuide.endpoints(doc, request.base_url)
      }
      response[:markdown] = doc.seed_content if doc.content_format == "markdown"
      render json: response, status: :created
    end

    # GET /api/docs/:slug — the document's full live state.
    def show
      touch_presence
      render json: AgentGuide.state(document, request.base_url)
    end
  end
end
