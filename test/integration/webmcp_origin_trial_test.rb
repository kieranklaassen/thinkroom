require "test_helper"

class WebmcpOriginTrialIntegrationTest < ActionDispatch::IntegrationTest
  setup do
    @original_token = Rails.application.config.x.webmcp_origin_trial_token
    @document = Document.create!(title: "Doc", seed_markdown: "# Hi")
  end

  teardown do
    Rails.application.config.x.webmcp_origin_trial_token = @original_token
  end

  test "emits the origin-trial meta tag when a token is configured" do
    Rails.application.config.x.webmcp_origin_trial_token = "AbC123+/="

    get "/d/#{@document.slug}", headers: browser_headers

    assert_response :success
    assert_select 'meta[http-equiv="origin-trial"][content="AbC123+/="]', count: 1
  end

  test "omits the origin-trial meta tag when no token is configured" do
    Rails.application.config.x.webmcp_origin_trial_token = nil

    get "/d/#{@document.slug}", headers: browser_headers

    assert_response :success
    assert_select 'meta[http-equiv="origin-trial"]', count: 0
  end

  private

  def browser_headers
    { "User-Agent" => "Mozilla/5.0" }
  end
end
