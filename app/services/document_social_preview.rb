class DocumentSocialPreview
  TITLE_MAX_GRAPHEMES = 160
  DESCRIPTION_MAX_GRAPHEMES = 240

  attr_reader :title, :description

  def initialize(document)
    raw_title = document.display_title.to_s.squish.presence || "Untitled"
    @title = bound(raw_title, TITLE_MAX_GRAPHEMES)
    @description = description_for(document, raw_title)
  end

  private

  def description_for(document, raw_title)
    plain_text = document.plain_text.to_s.squish
    excerpt = if plain_text == raw_title || plain_text.start_with?("#{raw_title} ")
      plain_text.delete_prefix(raw_title).strip
    else
      plain_text
    end
    bound(excerpt.presence || title, DESCRIPTION_MAX_GRAPHEMES)
  end

  def bound(text, maximum)
    graphemes = text.scan(/\X/)
    return text if graphemes.length <= maximum

    clipped = graphemes.first(maximum - 1).join.rstrip
    word_boundary = clipped.sub(/\s+\S*\z/, "").presence
    "#{word_boundary || clipped}…"
  end
end
