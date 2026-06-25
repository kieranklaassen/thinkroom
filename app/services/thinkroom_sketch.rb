class ThinkroomSketch
  FORMAT_VERSION = 1
  MAX_SCENE_BYTES = 512.kilobytes
  MAX_DESCRIPTION_LENGTH = 500
  MAX_ELEMENTS = 500
  MAX_POINTS = 20_000
  # Render-hint bounds for a sketch's reserved height. Enforced TS-side by
  # normalizeSketchData; mirrored here as the single Ruby source of truth so the
  # agent contract and the preview skeleton clamp cannot drift apart.
  DEFAULT_HEIGHT = 448
  MIN_HEIGHT = 180
  MAX_HEIGHT = 1200
  ELEMENT_TYPES = %w[
    rectangle diamond ellipse line arrow freedraw text frame
  ].freeze
  SAFE_COLOR = /\A(?:transparent|#[0-9a-f]{3,8})\z/i

  Parsed = Data.define(:scene, :description, :labels, :shape_types) do
    def semantic_text
      parts = [ description.presence, labels.presence&.join(", ") ].compact
      parts.empty? ? "Sketch" : "Sketch: #{parts.join(" — ")}"
    end
  end

  class << self
    def parse(scene_json, description: "", format_version: FORMAT_VERSION)
      source = scene_json.to_s
      return if source.blank? || source.bytesize > MAX_SCENE_BYTES
      return unless format_version.to_i == FORMAT_VERSION

      scene = JSON.parse(source)
      return unless valid_scene?(scene)

      description = description.to_s.strip
      return if description.length > MAX_DESCRIPTION_LENGTH
      labels = scene.fetch("elements").filter_map do |element|
        next unless element["type"] == "text"

        element["text"].to_s.squish.presence
      end.uniq.first(50)
      shape_types = scene.fetch("elements").filter_map { |element| element["type"] }.uniq

      Parsed.new(scene:, description:, labels:, shape_types:)
    rescue JSON::ParserError, JSON::NestingError
      nil
    end

    private

    def valid_scene?(scene)
      return false unless scene.is_a?(Hash)
      return false unless scene["type"] == "excalidraw" && scene["version"].to_i.positive?

      elements = scene["elements"]
      return false unless elements.is_a?(Array) && elements.length <= MAX_ELEMENTS
      return false unless scene["appState"].nil? || scene["appState"].is_a?(Hash)
      return false unless scene["files"].nil? || scene["files"] == {}
      return false unless safe_color?(scene.dig("appState", "viewBackgroundColor"))
      return false unless valid_app_state?(scene["appState"] || {})

      point_count = 0
      elements.all? do |element|
        next false unless element.is_a?(Hash) && ELEMENT_TYPES.include?(element["type"])
        next false if element["fileId"].present? || element["link"].present?
        next false unless safe_color?(element["strokeColor"]) && safe_color?(element["backgroundColor"])

        points = element["points"]
        next false unless points.nil? || points.is_a?(Array)
        next false unless points.nil? || points.all? { |point| valid_point?(point) }

        point_count += points&.length.to_i
        point_count <= MAX_POINTS
      end
    end

    def safe_color?(value)
      value.nil? || value.to_s.match?(SAFE_COLOR)
    end

    def valid_point?(point)
      point.is_a?(Array) && point.length >= 2 &&
        point.first(2).all? { |coordinate| coordinate.is_a?(Numeric) && coordinate.finite? }
    end

    def valid_app_state?(app_state)
      return false unless [ nil, "light", "dark" ].include?(app_state["theme"])
      return false unless app_state["gridSize"].nil? || finite_number?(app_state["gridSize"])
      return false unless app_state["gridStep"].nil? || finite_number?(app_state["gridStep"])

      %w[gridModeEnabled objectsSnapModeEnabled zenModeEnabled].all? do |key|
        app_state[key].nil? || [ true, false ].include?(app_state[key])
      end
    end

    def finite_number?(value)
      value.is_a?(Numeric) && value.finite?
    end
  end
end
