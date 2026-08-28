require "test_helper"

class WebmcpOriginTrialIntegrationTest < ActionDispatch::IntegrationTest
  setup do
    @original_tokens = Rails.application.config.x.webmcp_origin_trial_tokens
    @document = Document.create!(title: "Doc", seed_markdown: "# Hi")
  end

  teardown do
    Rails.application.config.x.webmcp_origin_trial_tokens = @original_tokens
  end

  test "emits one origin-trial meta tag per configured token" do
    Rails.application.config.x.webmcp_origin_trial_tokens = [ "AbC123+/=", "XyZ789==" ]

    get "/d/#{@document.slug}", headers: browser_headers

    assert_response :success
    assert_select 'meta[http-equiv="origin-trial"]', count: 2
    assert_select 'meta[http-equiv="origin-trial"][content="AbC123+/="]', count: 1
    assert_select 'meta[http-equiv="origin-trial"][content="XyZ789=="]', count: 1
  end

  test "omits the origin-trial meta tag when no token is configured" do
    Rails.application.config.x.webmcp_origin_trial_tokens = []

    get "/d/#{@document.slug}", headers: browser_headers

    assert_response :success
    assert_select 'meta[http-equiv="origin-trial"]', count: 0
  end

  private

  def browser_headers
    { "User-Agent" => "Mozilla/5.0" }
  end
end
