class DocumentSocialPreview
  TITLE_MAX_GRAPHEMES = 96
  DESCRIPTION_MAX_GRAPHEMES = 125
  PAGE_TITLE_MAX_GRAPHEMES = 60
  PAGE_TITLE_SUFFIXES = [
    " — A collaborative document shared with you on Thinkroom",
    " — A collaborative document shared on Thinkroom",
    " — Open this shared document on Thinkroom",
    " — Read and collaborate on Thinkroom"
  ].freeze
  PAGE_TITLE_FALLBACK_SUFFIX = " · Thinkroom"

  attr_reader :title, :description, :page_title

  def initialize(document)
    raw_title = document.display_title.to_s.squish.presence || "Untitled"
    @title = bound(raw_title, TITLE_MAX_GRAPHEMES)
    @description = description_for(document, raw_title)
    @page_title = page_title_for(raw_title)
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

  def page_title_for(raw_title)
    PAGE_TITLE_SUFFIXES.each do |suffix|
      descriptive = "#{raw_title}#{suffix}"
      return descriptive if descriptive.scan(/\X/).length <= PAGE_TITLE_MAX_GRAPHEMES
    end

    title_budget = PAGE_TITLE_MAX_GRAPHEMES - PAGE_TITLE_FALLBACK_SUFFIX.scan(/\X/).length
    "#{bound(raw_title, title_budget)}#{PAGE_TITLE_FALLBACK_SUFFIX}"
  end

  def bound(text, maximum)
    graphemes = text.scan(/\X/)
    return text if graphemes.length <= maximum

    clipped = graphemes.first(maximum - 1).join.rstrip
    word_boundary = clipped.sub(/\s+\S*\z/, "").presence
    "#{word_boundary || clipped}…"
  end
end
