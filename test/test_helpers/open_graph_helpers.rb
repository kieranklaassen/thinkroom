# Shared helpers for integration tests that inspect Open Graph / Twitter
# metadata: a real-browser request header set and Nokogiri meta-tag lookups.
module OpenGraphHelpers
  private

  def browser
    {
      "User-Agent" => "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      "Accept" => "text/html"
    }
  end

  def property(page, name)
    page.at_css(%(meta[property="#{name}"]))&.[]("content")
  end

  def named(page, name)
    page.at_css(%(meta[name="#{name}"]))&.[]("content")
  end
end
