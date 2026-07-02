# Server-side sketch rendering for the static first-paint preview: the full
# <figure> the live node view builds (frame, washi tape, caption) holding an
# SVG port of the editor's lightweight renderer
# (app/frontend/editor/sketch/preview.ts renderSketchPreview), so first paint
# shows the actual drawing instead of a blank box. Figure structure mirrors
# node_view.ts and the SVG must stay geometrically identical to preview.ts:
# same bounds math, same padding, same primitives — the live editor paints
# the same shapes over this at swap time and any drift reads as flicker.
#
# Input scenes come exclusively through ThinkroomSketch.parse, which validates
# element types, colors (SAFE_COLOR), and point shapes — so attribute values
# interpolated here are already constrained, and all text lands in Nokogiri
# text nodes (escaped).
class SketchPreview
  PADDING = 24 # SKETCH_PADDING in preview.ts

  class << self
    # The sketch <figure> matching the live node view: frame + deterministic
    # tape variation + preview area at the reserved height + caption.
    # parsed: a ThinkroomSketch::Parsed with a present (editor-valid) id.
    def figure(document, parsed, interactive:)
      figure = element(document, "figure",
        "class" => interactive ? "thinkroom-sketch is-editable" : "thinkroom-sketch",
        "data-sketch-id" => parsed.id,
        "style" => tape_style(parsed.id))

      preview = element(document, "div",
        "class" => "thinkroom-sketch-preview",
        "style" => "height: #{parsed.height}px")
      preview << svg(parsed.scene, document:)
      figure << preview

      caption_classes = [ "thinkroom-sketch-caption" ]
      caption_classes << "is-empty" if parsed.description.blank?
      caption_classes << "is-editable" if interactive
      caption = element(document, "figcaption", "class" => caption_classes.join(" "))
      title = element(document, "input",
        "class" => "thinkroom-sketch-title",
        "type" => "text",
        "value" => parsed.description,
        "readonly" => "",
        "tabindex" => "-1",
        "aria-label" => "Sketch title")
      title["placeholder"] = "Add a title…" if interactive
      caption << title
      figure << caption

      figure
    end

    # scene: a validated scene Hash (ThinkroomSketch::Parsed#scene).
    # Returns an SVG element (Nokogiri node) built in `document`'s context.
    def svg(scene, document:)
      live = scene.fetch("elements", []).reject { |element| element["isDeleted"] == true }
      bounds = content_bounds(live)

      min_x = bounds ? bounds[:min_x] - PADDING : 0
      min_y = bounds ? bounds[:min_y] - PADDING : 0
      width = bounds ? [ 240, bounds[:max_x] - bounds[:min_x] + PADDING * 2 ].max : 640
      height = bounds ? [ 140, bounds[:max_y] - bounds[:min_y] + PADDING * 2 ].max : 320

      svg = element(document, "svg",
        "viewBox" => "#{fmt(min_x)} #{fmt(min_y)} #{fmt(width)} #{fmt(height)}",
        "role" => "img",
        "preserveAspectRatio" => "xMidYMid meet",
        "class" => "sketch-preview-svg")
      svg << element(document, "rect",
        "x" => fmt(min_x), "y" => fmt(min_y),
        "width" => fmt(width), "height" => fmt(height),
        "fill" => "transparent")

      live.each { |el| svg << shape(document, el) }

      if bounds.nil?
        label = element(document, "text",
          "x" => fmt(width / 2.0), "y" => fmt(height / 2.0),
          "text-anchor" => "middle", "fill" => "#8b867f",
          "font-size" => "18", "font-family" => "system-ui, sans-serif")
        label.content = "Empty sketch"
        svg << label
      end

      svg
    end

    private

    # Mirrors contentBounds in preview.ts: rotated AABB over live elements.
    # Returns nil for an empty scene (the "Empty sketch" placeholder case).
    def content_bounds(live)
      bounds = live.reduce(min_x: Float::INFINITY, min_y: Float::INFINITY,
                           max_x: -Float::INFINITY, max_y: -Float::INFINITY) do |box, el|
        x = number(el["x"])
        y = number(el["y"])
        width = number(el["width"]).abs
        height = number(el["height"]).abs
        angle = number(el["angle"])
        rotated_width = (width * Math.cos(angle)).abs + (height * Math.sin(angle)).abs
        rotated_height = (width * Math.sin(angle)).abs + (height * Math.cos(angle)).abs
        center_x = x + number(el["width"]) / 2.0
        center_y = y + number(el["height"]) / 2.0
        {
          min_x: [ box[:min_x], center_x - rotated_width / 2.0 ].min,
          min_y: [ box[:min_y], center_y - rotated_height / 2.0 ].min,
          max_x: [ box[:max_x], center_x + rotated_width / 2.0 ].max,
          max_y: [ box[:max_y], center_y + rotated_height / 2.0 ].max
        }
      end
      bounds[:min_x].finite? ? bounds : nil
    end

    def shape(document, el)
      x = number(el["x"])
      y = number(el["y"])
      w = number(el["width"])
      h = number(el["height"])
      stroke = string(el["strokeColor"], "#1b1b1f")
      fill = string(el["backgroundColor"], "transparent")
      stroke_width = number(el["strokeWidth"], 2)
      opacity = number(el["opacity"], 100) / 100.0
      angle_deg = number(el["angle"]) * 180 / Math::PI

      group = element(document, "g",
        "opacity" => fmt(opacity),
        "transform" => "rotate(#{fmt(angle_deg)} #{fmt(x + w / 2.0)} #{fmt(y + h / 2.0)})")
      common = {
        "stroke" => stroke, "stroke-width" => fmt(stroke_width),
        "fill" => fill, "stroke-linecap" => "round"
      }

      case el["type"]
      when "rectangle", "frame"
        group << element(document, "rect",
          "x" => fmt(x), "y" => fmt(y), "width" => fmt(w), "height" => fmt(h),
          "rx" => "4", **common)
      when "ellipse"
        group << element(document, "ellipse",
          "cx" => fmt(x + w / 2.0), "cy" => fmt(y + h / 2.0),
          "rx" => fmt((w / 2.0).abs), "ry" => fmt((h / 2.0).abs), **common)
      when "diamond"
        points = "#{fmt(x + w / 2.0)},#{fmt(y)} #{fmt(x + w)},#{fmt(y + h / 2.0)} " \
                 "#{fmt(x + w / 2.0)},#{fmt(y + h)} #{fmt(x)},#{fmt(y + h / 2.0)}"
        group << element(document, "polygon", "points" => points, **common)
      when "line", "arrow", "freedraw"
        raw_points = el["points"].is_a?(Array) ? el["points"] : []
        pairs = raw_points.select { |p| p.is_a?(Array) && p.length >= 2 }
        points = pairs.map { |p| "#{fmt(x + number(p[0]))},#{fmt(y + number(p[1]))}" }.join(" ")
        group << element(document, "polyline", "points" => points, **common, "fill" => "none")
        group << arrow_head(document, x, y, pairs, stroke, stroke_width) if el["type"] == "arrow" && pairs.length >= 2
      when "text"
        font_size = number(el["fontSize"], 20)
        text = element(document, "text",
          "x" => fmt(x), "y" => fmt(y + font_size),
          "fill" => stroke, "stroke" => "none",
          "font-size" => fmt(font_size), "font-family" => "system-ui, sans-serif")
        string(el["text"], "").split("\n", -1).each_with_index do |line, index|
          tspan = element(document, "tspan", "x" => fmt(x), "dy" => index.zero? ? "0" : fmt(font_size * 1.25))
          tspan.content = line
          text << tspan
        end
        group << text
      end

      group
    end

    def arrow_head(document, x, y, pairs, stroke, stroke_width)
      last = pairs[-1]
      before = pairs[-2]
      ex = x + number(last[0])
      ey = y + number(last[1])
      angle = Math.atan2(ey - (y + number(before[1])), ex - (x + number(before[0])))
      size = [ 8, stroke_width * 4 ].max
      points = "#{fmt(ex - Math.cos(angle - 0.55) * size)},#{fmt(ey - Math.sin(angle - 0.55) * size)} " \
               "#{fmt(ex)},#{fmt(ey)} " \
               "#{fmt(ex - Math.cos(angle + 0.55) * size)},#{fmt(ey - Math.sin(angle + 0.55) * size)}"
      element(document, "polyline",
        "points" => points, "stroke" => stroke, "stroke-width" => fmt(stroke_width),
        "fill" => "none", "stroke-linecap" => "round")
    end

    # FNV-1a over the id's code points, matching syncTapeVariation in
    # app/frontend/editor/sketch/node_view.ts so the washi tape sits at the
    # identical width/offset/angle across the preview → editor swap.
    def tape_style(id)
      hash = id.to_s.each_char.reduce(2_166_136_261) do |acc, character|
        ((acc ^ character.ord) * 16_777_619) & 0xFFFFFFFF
      end
      width = 86 + hash % 23
      offset = ((hash >> 8) % 21) - 10
      angle = (((hash >> 16) % 29) - 14) / 10.0
      "--sketch-tape-width: #{width}px; --sketch-tape-offset: #{offset}px; --sketch-tape-angle: #{fmt(angle)}deg"
    end

    def element(document, name, attrs = {})
      node = Nokogiri::XML::Node.new(name, document)
      attrs.each { |key, value| node[key] = value.to_s }
      node
    end

    def number(value, fallback = 0)
      value.is_a?(Numeric) && value.to_f.finite? ? value.to_f : fallback.to_f
    end

    def string(value, fallback)
      value.is_a?(String) ? value : fallback
    end

    # Match JavaScript number-to-string: integers without a trailing .0.
    def fmt(value)
      float = value.to_f
      float == float.truncate ? float.truncate.to_s : float.to_s
    end
  end
end
