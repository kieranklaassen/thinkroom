class DocumentAsset < ApplicationRecord
  EXPIRY = 1.hour
  ACTIVE_STORAGE_SRC = %r{
    \A/rails/active_storage/blobs/(?:redirect|proxy)/([^/]+)/
  }x

  belongs_to :document, optional: true
  has_one_attached :file

  validates :uploader_name, presence: true, length: { maximum: 255 }
  validates :expires_at, presence: true

  scope :unclaimed, -> { where(document_id: nil) }
  scope :expired, -> { unclaimed.where(expires_at: ..Time.current) }

  before_destroy :purge_file

  class << self
    def store!(processed:, uploader_name:)
      purge_expired!
      ensure_capacity!(processed.io.size)

      asset = create!(
        uploader_name: Document.normalize_display_name(uploader_name),
        expires_at: EXPIRY.from_now
      )
      blob = ActiveStorage::Blob.create_after_unfurling!(
        io: processed.io,
        filename: processed.filename,
        content_type: processed.content_type,
        metadata: { width: processed.width, height: processed.height },
        identify: false
      )
      processed.io.rewind
      blob.upload_without_unfurling(processed.io)
      asset.file.attach(blob)
      asset
    rescue
      blob&.purge
      asset&.destroy!
      raise
    end

    def claim_from_html!(document:, source:)
      blob_ids_from(source).each do |blob_id|
        joins(:file_attachment)
          .unclaimed
          .find_by(active_storage_attachments: { blob_id: blob_id })
          &.update!(document:, expires_at: 100.years.from_now)
      end
    end

    def purge_expired!
      expired.find_each(&:destroy!)
    end

    private

    def blob_ids_from(source)
      Nokogiri::HTML5.fragment(source.to_s).css("img[src]").filter_map do |image|
        match = ACTIVE_STORAGE_SRC.match(image["src"].to_s)
        ActiveStorage::Blob.find_signed(match[1])&.id if match
      rescue ActiveSupport::MessageVerifier::InvalidSignature, ActiveRecord::RecordNotFound
        nil
      end.uniq
    end

    def ensure_capacity!(incoming_bytes)
      used = unclaimed.joins(:file_attachment)
        .joins("INNER JOIN active_storage_blobs ON active_storage_blobs.id = active_storage_attachments.blob_id")
        .sum("active_storage_blobs.byte_size")
      raise ImageUploadPolicy::CapacityExceeded, "temporary upload capacity is full" if used + incoming_bytes > ImageUploadPolicy::MAX_UNCLAIMED_BYTES
    end
  end

  private

  def purge_file
    file.purge if file.attached?
  end
end
