require "test_helper"

class DocumentOpenGraphTest < ActionDispatch::IntegrationTest
  setup do
    @document = Document.create!(
      title: "Stored title",
      seed_content: "# Product & market\n\nA focused explanation with <unsafe> source text."
    )
  end

  test "document HTML exposes escaped Open Graph and Twitter metadata" do
    host! "thinkroom.kieranklaassen.com"
    https!
    get document_page_path(@document.slug), headers: browser

    assert_response :success
    page = Nokogiri::HTML5(response.body)
    image_url = property(page, "og:image")

    assert_equal "article", property(page, "og:type")
    assert_equal "Product & market", property(page, "og:title")
    assert_equal "A focused explanation with source text.", property(page, "og:description")
    assert_equal "https://thinkroom.kieranklaassen.com/d/#{@document.slug}", property(page, "og:url")
    assert_equal "1200", property(page, "og:image:width")
    assert_equal "630", property(page, "og:image:height")
    assert_equal "summary_large_image", named(page, "twitter:card")
    assert_equal property(page, "og:title"), named(page, "twitter:title")
    assert_equal image_url, named(page, "twitter:image")
    assert_equal URI(image_url).path, document_og_image_path(@document.slug)
    assert URI(image_url).query.include?("v=")
    refute_includes property(page, "og:image:alt"), "Thinkroom"
    assert_equal property(page, "og:url"), page.at_css('link[rel="canonical"]')["href"]
  end

  test "the image URL version changes after a document update" do
    get document_page_path(@document.slug), headers: browser
    first_url = property(Nokogiri::HTML5(response.body), "og:image")

    travel 1.second do
      @document.update!(content_snapshot: "# Revised title\n\nRevised body")
    end
    get document_page_path(@document.slug), headers: browser
    second_url = property(Nokogiri::HTML5(response.body), "og:image")

    refute_equal first_url, second_url
  end

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
