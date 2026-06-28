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

    # PATCH/PUT /api/docs/:slug — revise a document in place. Unclaimed drafts
    # still use the seed-stage path. An authenticated account owner may also
    # replace their own live document, but because that discards human edits,
    # the live CRDT/snapshot state, and pending suggestions, it requires an
    # explicit force opt-in — a bare update is refused rather than silently
    # destroying that work (issue #121). Non-owners on claimed/live documents
    # keep the suggestion workflow so a full replacement never bypasses ownership.
    def update
      force = ActiveModel::Type::Boolean.new.cast(params[:force])
      live_owner_replacement = !document.seed_stage? && owner_via_cli_token?
      return render_update_conflict unless live_owner_replacement || (document.seed_stage? && updatable_in_place?)

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

      # Replacing the content of a claimed, live document destroys human browser
      # edits, the live CRDT state, and any pending suggestions. Never do that
      # silently: require an explicit force opt-in so a routine update can't look
      # like success while corrupting the document (issue #121). A title-only
      # owner update is non-destructive and stays allowed without force.
      return render_claimed_replacement_warning if live_owner_replacement && content.present? && !force

      normalized = false
      warning = nil
      source = nil
      content_reset = false
      if content.present?
        source, normalized, warning = normalized_source_and_signal(document.content_format, content)
        # Only (re)attribute when an agent identifies itself; an anonymous
        # update preserves the original seed authorship rather than erasing it.
        kind, name = agent_seed_attribution(content)
        if live_owner_replacement
          document.replace_content!(
            source:,
            title: new_title,
            seed_author_kind: kind,
            seed_author_name: name
          )
          content_reset = true
        else
          document.seed_content = source
          if kind
            document.seed_author_kind = kind
            document.seed_author_name = name
          end
        end
      end
      unless live_owner_replacement && content.present?
        document.title = new_title if new_title.present?
        document.save!
      end
      # Claim assets only after the content that references them is persisted,
      # so a failed save never binds assets to content that was never stored.
      DocumentAsset.claim_from_html!(document:, source:) if source && document.html?

      if current_agent
        Activity.log!(
          document:, actor_name: current_agent, actor_kind: "agent",
          action: "updated_document", detail: document.title
        )
      end
      if content_reset
        DocumentMetaChannel.broadcast_event(document, :content_reset)
        # The replacement cleared pending suggestions; tell open panels to refresh.
        DocumentMetaChannel.broadcast_event(document, :suggestions)
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

    # A seed-stage document is revisable in place by the agent/anonymous flow
    # while it is still unclaimed, or by the authenticated CLI account that owns
    # it. seed_stage? is checked separately and always required.
    def updatable_in_place?
      document.claimable? || owner_via_cli_token?
    end

    # True only when a valid CLI Bearer token's account owns a document that can
    # be individually owned. Account ownership only (owned_by? with user:) — the
    # CLI authenticates as an account, so a guest owner_token cookie is
    # irrelevant. The unclaimable? guard keeps a permanently shared document
    # (the demo) out of this path even if a future code path ever assigned it an
    # owner, rather than relying on that invariant holding elsewhere.
    def owner_via_cli_token?
      current_api_user.present? && !document.unclaimable? &&
        document.owned_by?(nil, user: current_api_user)
    end

    # The owner CAN replace their own document, but past the seed stage that
    # discards human browser edits, the live CRDT state, and pending suggestions.
    # Refuse a bare update so it can never silently destroy that work (issue
    # #121): teach the safe suggestion path and the explicit force opt-in the
    # owner uses when an overwrite is genuinely intended.
    def render_claimed_replacement_warning
      suggestions_url = "#{api_doc_url(document.slug)}/suggestions"
      render json: {
        error: "This document has been claimed and edited in the browser, so its live editor " \
               "state is authoritative. Updating it would overwrite those human edits and discard " \
               "pending suggestions.",
        next_action: "Propose a suggestion instead (POST #{suggestions_url}), or re-run with " \
                     "--force (force: true) to replace the live document and reset its editor state.",
        propose_suggestion: suggestions_url,
        force_hint: "Add --force (CLI) or force: true (API) to overwrite the claimed document."
      }, status: :conflict
    end

    # A well-formed request that conflicts with the document's current state.
    # Non-owners land here on a claimed or collaboratively edited document
    # (owners get render_claimed_replacement_warning instead). Teach the correct
    # next action rather than failing opaquely or silently no-opping a seed write.
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
