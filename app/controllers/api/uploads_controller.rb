module Api
  class UploadsController < BaseController
    before_action :require_agent!

    MAX_BYTES = 10.megabytes
    CONTENT_TYPES = %w[image/png image/jpeg image/gif image/webp].freeze

    # POST /api/uploads — upload an image for use in an HTML document.
    def create
      upload = params[:file]
      unless upload.respond_to?(:tempfile) && upload.respond_to?(:original_filename)
        return render json: {
          error: "file is required.",
          example: %(curl -X POST #{request.base_url}/api/uploads -H "X-Agent-Name: Scout" -F "file=@figure.png")
        }, status: :unprocessable_entity
      end

      if upload.size > MAX_BYTES
        return render json: {
          error: "file is too large.",
          max_bytes: MAX_BYTES
        }, status: :content_too_large
      end

      content_type = Marcel::MimeType.for(upload.tempfile)
      unless CONTENT_TYPES.include?(content_type)
        return render json: {
          error: "file must be a PNG, JPEG, GIF, or WebP image.",
          detected_content_type: content_type,
          allowed_content_types: CONTENT_TYPES
        }, status: :unprocessable_entity
      end

      blob = ActiveStorage::Blob.create_and_upload!(
        io: upload.tempfile,
        filename: upload.original_filename,
        content_type: content_type,
        identify: false
      )
      src = rails_service_blob_path(blob.signed_id, blob.filename, only_path: true)

      render json: {
        src: src,
        url: "#{request.base_url}#{src}",
        filename: blob.filename.to_s,
        content_type: blob.content_type,
        byte_size: blob.byte_size,
        html: %(<img src="#{src}" alt="#{ERB::Util.html_escape(blob.filename.base)}">),
        note: "Use src exactly as returned. Remote, data:, and arbitrary same-origin image URLs are removed from HTML documents."
      }, status: :created
    end
  end
end
