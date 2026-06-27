module Api
  class DocsController < BaseController
    rate_limit_document_creation
    rate_limit_document_update

    # GET /api/docs — API entry point plus the authenticated account's docs.
    def index
      render json: {
        documents: index_documents.map { |doc| index_document_response(doc) },
        api: {
          create_document: AgentGuide.create_document_endpoint(request.base_url)
        },
        notes: index_notes
      }
    end

    # POST /api/docs — create a typed source document, get back its slug.
    def create
      content = params[:content].presence
      requested_format = request.request_parameters["format"].presence
      format = requested_format || "markdown"
      if requested_format && content.blank?
        return render json: { error: "content is required when format is provided." },
                      status: :unprocessable_entity
      end
      unless Document::CONTENT_FORMATS.include?(format)
        return render json: { error: "format must be markdown or html." },
                      status: :unprocessable_entity
      end
      return if reject_oversized_content(content)

      source, normalized, warning = normalized_source_and_signal(format, content, fallback: Document::DEFAULT_SEED)
      kind, name = agent_seed_attribution(content)
      doc = Document.create!(
        title: params[:title].presence || "Untitled",
        content_format: format,
        seed_content: source,
        seed_author_kind: kind,
        seed_author_name: name,
        user: current_api_user,
        owner_name: current_api_user&.name
      )
      DocumentAsset.claim_from_html!(document: doc, source:) if doc.html?

      if current_agent
        Activity.log!(
          document: doc, actor_name: current_agent, actor_kind: "agent",
          action: "created_document", detail: doc.title
        )
      end

      render json: agent_document_response(doc, normalized:, warning:), status: :created
    end

    # GET /api/docs/:slug — the document's full live state.
    def show
      touch_presence
      render json: AgentGuide.state(document, request.base_url)
    end

    # PATCH/PUT /api/docs/:slug — revise a document's seed in place while it is
    # still an unclaimed draft. Same slug, same share URL, so the link the agent
    # already shared keeps working. The moment a human gets involved — claiming
    # the document, or opening it so an editor snapshot / live CRDT exists — the
    # live document is authoritative and the seed is no longer what readers see.
    # A seed write there would 200 while changing nothing, so this returns 409
    # and points the agent at suggestions instead of lying about success.
    def update
      return render_update_conflict unless document.seed_stage? && document.claimable?

      requested_format = request.request_parameters["format"].presence
      if requested_format && requested_format != document.content_format
        return render json: {
          error: "content_format is immutable; this document is #{document.content_format}.",
          content_format: document.content_format
        }, status: :unprocessable_entity
      end

      content = params[:content].presence
      new_title = params[:title].presence
      if content.blank? && new_title.blank?
        return render json: { error: "Send a title or content to update." },
                      status: :unprocessable_entity
      end
      return if reject_oversized_content(content)

      normalized = false
      warning = nil
      source = nil
      if content.present?
        source, normalized, warning = normalized_source_and_signal(document.content_format, content)
        document.seed_content = source
        # Only (re)attribute when an agent identifies itself; an anonymous
        # update preserves the original seed authorship rather than erasing it.
        kind, name = agent_seed_attribution(content)
        if kind
          document.seed_author_kind = kind
          document.seed_author_name = name
        end
      end
      document.title = new_title if new_title.present?
      document.save!
      # Claim assets only after the content that references them is persisted,
      # so a failed save never binds assets to content that was never stored.
      DocumentAsset.claim_from_html!(document:, source:) if source && document.html?

      if current_agent
        Activity.log!(
          document:, actor_name: current_agent, actor_kind: "agent",
          action: "updated_document", detail: document.title
        )
      end

      render json: agent_document_response(document, normalized:, warning:), status: :ok
    end

    private

    def index_documents
      return Document.none unless current_api_user

      current_api_user.documents.order(created_at: :desc).limit(50)
    end

    def index_document_response(doc)
      {
        slug: doc.slug,
        title: doc.title,
        share_url: document_page_url(doc.slug),
        api_url: api_doc_url(doc.slug),
        content_format: doc.content_format,
        created_at: doc.created_at.iso8601,
        updated_at: doc.updated_at.iso8601
      }
    end

    def index_notes
      return [ "Authenticated with a Thinkroom CLI token; documents are scoped to that account." ] if current_api_user

      [ "Send a Bearer token from `thinkroom login` to list account documents. Anonymous requests can still create documents with POST /api/docs." ]
    end

    # A well-formed request that conflicts with the document's current state: a
    # human has claimed or started editing it, so the live document — not the
    # seed — is authoritative. Teach the agent the correct next action rather
    # than failing opaquely or silently no-opping a seed write.
    def render_update_conflict
      revision_workflow = AgentGuide.revision_workflow(document, request.base_url)
      steps = revision_workflow.fetch(:steps).index_by { |step| step.fetch(:action) }
      render json: {
        error: "This document is no longer an unclaimed draft — a human has claimed or started editing it, so its live state is authoritative.",
        how_to_revise: "#{revision_workflow[:guidance]} #{revision_workflow[:when_no_open_comments]}",
        read_state: steps.fetch("read_open_comments").fetch(:url),
        propose_suggestion: steps.fetch("propose_targeted_suggestion").fetch(:url),
        resolve_comment: steps.fetch("resolve_addressed_comment").fetch(:url),
        revision_workflow:
      }, status: :conflict
    end

    # Shared byte-cap guard (used by create and update). Renders an error and
    # returns true when it fires, so callers `return if reject_oversized_content`.
    def reject_oversized_content(content)
      return false unless content.to_s.bytesize > Document::MAX_CONTENT_BYTES

      render json: { error: "content is too long.", max_bytes: Document::MAX_CONTENT_BYTES },
             status: :content_too_large
      true
    end

    # Normalize agent-supplied source for a format and compute the
    # create/update normalization signal (normalized + warning) in one place,
    # so both actions report it identically. HTML is sanitized to the editable
    # schema; Markdown isn't server-normalized, but an excalidraw fence that
    # fails ThinkroomSketch.parse is silently kept as a dead code block — audit
    # the stored source so the response can report it instead of looking
    # byte-for-byte identical to a recognized sketch. `fallback` seeds the
    # source when no content was supplied (create's DEFAULT_SEED); callers with
    # guaranteed content omit it.
    def normalized_source_and_signal(format, content, fallback: nil)
      normalization = format == "html" ? HtmlDocumentSanitizer.external(content) : nil
      source = normalization&.content || content || fallback
      sketch_audit = format == "html" ? nil : MarkdownSketchAudit.call(source)
      normalized = normalization&.changed? || sketch_audit&.unrecognized? || false
      warning =
        if normalization&.changed?
          "Unsupported HTML was removed or normalized."
        else
          sketch_audit&.warning_message
        end
      [ source, normalized, warning ]
    end

    # Authorship is recorded only for agent-supplied source: the seeding client
    # attributes that text as AI prose. Blank/boilerplate content stays
    # unattributed — placeholder text must never be claimed as AI. Gate on the
    # normalized name so a whitespace-only header can never produce kind
    # "agent" with a blank author. Returns [kind, name].
    def agent_seed_attribution(content)
      name = Document.normalize_display_name(current_agent)
      return [ nil, nil ] unless name.present? && content.present?

      [ "agent", name ]
    end

    # The create/update success payload: one shape so an agent revising a
    # document sees the same fields — and the same normalization signal — it
    # saw on create.
    def agent_document_response(doc, normalized:, warning:)
      response = {
        slug: doc.slug,
        title: doc.title,
        share_url: document_page_url(doc.slug),
        content_format: doc.content_format,
        content: doc.current_content,
        plain_text: doc.plain_text,
        normalized: normalized,
        warning: warning,
        note: ownership_note(doc),
        content_contract: AgentGuide.content_contract(doc.content_format, request.base_url),
        api: AgentGuide.endpoints(doc, request.base_url)
      }
      response[:markdown] = doc.current_content if doc.content_format == "markdown"
      response
    end

    def ownership_note(doc)
      if doc.user_id?
        "This document belongs to your Thinkroom account and appears in your document list."
      else
        "This document is unclaimed. The first person to open the share URL in a browser can claim it — claiming grants them ownership (including delete)."
      end
    end
  end
end
