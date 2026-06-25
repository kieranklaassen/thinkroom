module Api
  class DocsController < BaseController
    rate_limit_document_creation
    rate_limit_document_update

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

      source, normalized, warning = normalized_source_and_signal(format, content, fallback: Document::DEFAULT_SEED)
      kind, name = agent_seed_attribution(content)
      doc = Document.create!(
        title: params[:title].presence || "Untitled",
        content_format: format,
        seed_content: source,
        seed_author_kind: kind,
        seed_author_name: name
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
    # still seed-stage. Same slug, same share URL, so the link the agent already
    # shared keeps working. Once an editor has taken over (yjs_state present)
    # the Yjs document is authoritative and the seed is no longer read — a seed
    # write there would 200 while changing nothing a human sees, so this returns
    # 409 and points the agent at suggestions instead of lying about success.
    def update
      return render_collaborative_conflict if document.yjs_state.present?

      if params.key?(:content) && params.key?(:markdown)
        return render json: { error: "Send content or legacy markdown, not both." },
                      status: :unprocessable_entity
      end

      requested_format = request.request_parameters["format"].presence
      if requested_format && requested_format != document.content_format
        return render json: {
          error: "content_format is immutable; this document is #{document.content_format}.",
          content_format: document.content_format
        }, status: :unprocessable_entity
      end

      legacy_markdown = params[:markdown].presence
      if legacy_markdown && document.content_format != "markdown"
        return render json: { error: "The markdown field can only update Markdown documents." },
                      status: :unprocessable_entity
      end

      content = params[:content].presence || legacy_markdown
      new_title = params[:title].presence
      if content.blank? && new_title.blank?
        return render json: { error: "Send a title or content to update." },
                      status: :unprocessable_entity
      end
      if content.to_s.bytesize > Document::MAX_CONTENT_BYTES
        return render json: {
          error: "content is too long.",
          max_bytes: Document::MAX_CONTENT_BYTES
        }, status: :content_too_large
      end

      normalized = false
      warning = nil
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
        DocumentAsset.claim_from_html!(document:, source:) if document.html?
      end
      document.title = new_title if new_title.present?
      document.save!

      if current_agent
        Activity.log!(
          document:, actor_name: current_agent, actor_kind: "agent",
          action: "updated_document", detail: document.title
        )
      end

      render json: agent_document_response(document, normalized:, warning:), status: :ok
    end

    private

    # A well-formed request that conflicts with the document's current state:
    # collaboration has begun, so teach the agent the correct next action
    # rather than failing opaquely.
    def render_collaborative_conflict
      render json: {
        error: "This document is being edited collaboratively and can no longer be updated in place.",
        how_to_revise: "A human has started editing, so the Yjs document is now authoritative. " \
                       "Propose your change as a suggestion — it appears live in the editor, " \
                       "attributed to you, for a human to accept.",
        propose_suggestion: "#{request.base_url}/api/docs/#{document.slug}/suggestions"
      }, status: :conflict
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
        note: "This document is unclaimed. The first person to open the share URL in a browser can claim it — claiming grants them ownership (including delete).",
        content_contract: AgentGuide.content_contract(doc.content_format, request.base_url),
        api: AgentGuide.endpoints(doc, request.base_url)
      }
      response[:markdown] = doc.current_content if doc.content_format == "markdown"
      response
    end
  end
end
