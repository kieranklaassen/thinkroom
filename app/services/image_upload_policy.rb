require "stringio"

class ImageUploadPolicy
  MAX_INPUT_BYTES = 3.megabytes
  MAX_REQUEST_BYTES = MAX_INPUT_BYTES + 256.kilobytes
  MAX_DIMENSION = 6_000
  MAX_PIXELS = 20_000_000
  MAX_UNCLAIMED_BYTES = 50.megabytes
  INPUT_CONTENT_TYPES = %w[image/png image/jpeg image/webp].freeze
  OUTPUT_OPTIONS = {
    "image/png" => [ ".png", { strip: true, compression: 7 } ],
    "image/jpeg" => [ ".jpg", { strip: true, Q: 88, optimize_coding: true } ],
    "image/webp" => [ ".webp", { strip: true, Q: 86 } ]
  }.freeze

  Processed = Data.define(:io, :filename, :content_type, :width, :height, :input_byte_size)

  class InvalidImage < StandardError
    attr_reader :detected_content_type

    def initialize(message, detected_content_type: nil)
      @detected_content_type = detected_content_type
      super(message)
    end
  end

  class TooLarge < StandardError; end
  class CapacityExceeded < StandardError; end

  class << self
    def process(upload)
      raise TooLarge, "file is too large" if upload.size.to_i > MAX_INPUT_BYTES

      upload.tempfile.rewind
      bytes = upload.tempfile.read(MAX_INPUT_BYTES + 1)
      raise TooLarge, "file is too large" if bytes.bytesize > MAX_INPUT_BYTES

      detected_type = Marcel::MimeType.for(StringIO.new(bytes))
      unless INPUT_CONTENT_TYPES.include?(detected_type)
        raise InvalidImage.new(
          "file must be a PNG, JPEG, or WebP image",
          detected_content_type: detected_type
        )
      end

      image = Vips::Image.new_from_buffer(bytes, "", access: :sequential, fail_on: :warning)
      pages = image.get("n-pages") if image.get_fields.include?("n-pages")
      raise InvalidImage, "animated or multi-page images are not supported" if pages.to_i > 1

      image = image.autorot
      validate_dimensions!(image)

      extension, options = OUTPUT_OPTIONS.fetch(detected_type)
      output = image.write_to_buffer(extension, **options)
      filename = output_filename(upload.original_filename, extension)

      Processed.new(
        io: StringIO.new(output),
        filename: filename,
        content_type: detected_type,
        width: image.width,
        height: image.height,
        input_byte_size: bytes.bytesize
      )
    rescue Vips::Error
      raise InvalidImage, "file could not be decoded as a safe image"
    ensure
      upload.tempfile.rewind if upload.respond_to?(:tempfile)
    end

    def contract(base_url)
      {
        method: "POST",
        url: "#{base_url}/api/uploads",
        headers: { "X-Agent-Name": "required" },
        success_status: 201,
        request: {
          content_type: "multipart/form-data",
          field: "file",
          identity_header: "X-Agent-Name",
          allowed_content_types: INPUT_CONTENT_TYPES,
          max_bytes: MAX_INPUT_BYTES,
          max_dimension: MAX_DIMENSION,
          max_pixels: MAX_PIXELS
        },
        processing: "Images are decoded and re-encoded; metadata and unsupported payloads are removed."
      }
    end

    private

    def validate_dimensions!(image)
      if image.width > MAX_DIMENSION || image.height > MAX_DIMENSION
        raise InvalidImage, "image dimensions exceed #{MAX_DIMENSION} pixels"
      end
      if image.width * image.height > MAX_PIXELS
        raise InvalidImage, "image exceeds the #{MAX_PIXELS}-pixel limit"
      end
    end

    def output_filename(original_filename, extension)
      base = ActiveStorage::Filename.new(original_filename.to_s).base
      base = "image" if base.blank?
      "#{base.first(180)}#{extension}"
    end
  end
end
