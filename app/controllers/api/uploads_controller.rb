module Api
  class UploadsController < BaseController
    RATE_LIMIT_STORE = Rails.env.test? ? ActiveSupport::Cache::MemoryStore.new : Rails.cache

    rate_limit to: 20, within: 10.minutes, by: -> { request.remote_ip },
               with: :render_rate_limit, store: RATE_LIMIT_STORE, name: "burst"
    rate_limit to: 100, within: 1.day, by: -> { request.remote_ip },
               with: :render_rate_limit, store: RATE_LIMIT_STORE, name: "daily"
    before_action :reject_oversized_request!
    before_action :require_agent!

    # POST /api/uploads — upload an image for use in an HTML document.
    def create
      upload = params[:file]
      unless upload.respond_to?(:tempfile) && upload.respond_to?(:original_filename)
        return render json: {
          error: "file is required.",
          example: %(curl -X POST #{request.base_url}/api/uploads -H "X-Agent-Name: Scout" -F "file=@figure.png")
        }, status: :unprocessable_entity
      end

      processed = ImageUploadPolicy.process(upload)
      asset = DocumentAsset.store!(processed:, uploader_name: current_agent)
      blob = asset.file.blob
      src = rails_service_blob_path(blob.signed_id, blob.filename, only_path: true)
      escaped_src = ERB::Util.html_escape(src)
      escaped_alt = ERB::Util.html_escape(blob.filename.base)

      render json: {
        src: src,
        url: "#{request.base_url}#{src}",
        filename: blob.filename.to_s,
        content_type: blob.content_type,
        byte_size: blob.byte_size,
        width: blob.metadata["width"],
        height: blob.metadata["height"],
        expires_at: asset.expires_at.iso8601,
        html: %(<img src="#{escaped_src}" alt="#{escaped_alt}">),
        note: "Use src exactly as returned in HTML within one hour. Saving that HTML claims the image for the document."
      }, status: :created
    rescue ImageUploadPolicy::TooLarge
      render json: {
        error: "file is too large.",
        max_bytes: ImageUploadPolicy::MAX_INPUT_BYTES
      }, status: :content_too_large
    rescue ImageUploadPolicy::InvalidImage => error
      render json: {
        error: error.message,
        detected_content_type: error.detected_content_type,
        allowed_content_types: ImageUploadPolicy::INPUT_CONTENT_TYPES
      }.compact, status: :unprocessable_entity
    rescue ImageUploadPolicy::CapacityExceeded => error
      render json: { error: error.message }, status: :service_unavailable
    rescue ActiveStorage::IntegrityError, ActiveStorage::FileNotFoundError
      render json: { error: "image storage failed; retry the upload." }, status: :service_unavailable
    end

    private

    def reject_oversized_request!
      return unless request.content_length.to_i > ImageUploadPolicy::MAX_REQUEST_BYTES

      render json: {
        error: "request body is too large.",
        max_bytes: ImageUploadPolicy::MAX_INPUT_BYTES
      }, status: :content_too_large
    end

    def render_rate_limit
      render json: {
        error: "upload rate limit exceeded; retry later.",
        retry_after_seconds: 600
      }, status: :too_many_requests
    end
  end
end
