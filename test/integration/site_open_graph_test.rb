require "test_helper"

class SiteOpenGraphTest < ActionDispatch::IntegrationTest
  test "the landing page exposes site-level Open Graph and Twitter metadata" do
    host! "thinkroom.kieranklaassen.com"
    https!
    get root_path, headers: browser

    assert_response :success
    page = Nokogiri::HTML5(response.body)
    image_url = property(page, "og:image")

    assert_equal "website", property(page, "og:type")
    assert_equal "Thinkroom", property(page, "og:site_name")
    assert_equal "Thinkroom", property(page, "og:title")
    assert_includes property(page, "og:description"), "Where deeper thinking compounds."
    assert_equal property(page, "og:description"), named(page, "description")
    assert_equal "https://thinkroom.kieranklaassen.com/", property(page, "og:url")
    assert_equal "1200", property(page, "og:image:width")
    assert_equal "630", property(page, "og:image:height")
    assert_equal "summary_large_image", named(page, "twitter:card")
    assert_equal property(page, "og:title"), named(page, "twitter:title")
    assert_equal image_url, named(page, "twitter:image")
    assert_equal URI(image_url).path, site_og_image_path
    assert_equal "v=#{SiteOgImage::VERSION}", URI(image_url).query
    assert_includes property(page, "og:image:alt"), "Thinkroom"
    assert_equal "Thinkroom", page.at_css("title").text
    assert_equal property(page, "og:url"), page.at_css('link[rel="canonical"]')["href"]
  end

  test "document pages keep the article og:type" do
    document = Document.create!(title: "Doc", seed_content: "# Doc\n\nBody")
    get document_page_path(document.slug), headers: browser

    assert_response :success
    assert_equal "article", property(Nokogiri::HTML5(response.body), "og:type")
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
