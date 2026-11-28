require "test_helper"

# What the browser half of Inertia relies on in the server's answers.
class InertiaProtocolTest < ActionDispatch::IntegrationTest
  BROWSER = { "User-Agent" => "Mozilla/5.0 (Macintosh) Chrome/126 Safari/537.36" }.freeze

  setup { @document = Document.create!(title: "Doc", seed_markdown: "# Hello", seed_state: "done") }

  test "the first page keeps markup in props inside its script element" do
    @document.update!(title: "</script><b id=escaped>& ")
    original = ActiveSupport.escape_html_entities_in_json
    [ true, false ].each do |setting|
      ActiveSupport.escape_html_entities_in_json = setting
      get document_mode_path(@document.slug, "edit"), headers: BROWSER
      assert_response :success
      assert_select "b#escaped", 0
      page = JSON.parse(css_select("script[data-page=app]").first.text)
      assert_equal @document.title, page.dig("props", "document", "title")
    end
  ensure
    ActiveSupport.escape_html_entities_in_json = original
  end

  test "history stays encrypted and is not cleared" do
    get root_path, headers: inertia_headers
    assert_equal true, response.parsed_body["encryptHistory"]
    assert_not response.parsed_body["clearHistory"]
  end

  test "responses vary by X-Inertia" do
    get root_path, headers: BROWSER
    assert_includes response.headers["Vary"].split(/,\s*/), "X-Inertia"
    get root_path, headers: inertia_headers
    assert_includes response.headers["Vary"].split(/,\s*/), "X-Inertia"
  end

  test "a visit from older assets reloads the page and keeps the errors for it" do
    post login_path, params: { email: "nobody@example.com", password: "wrong" }, headers: inertia_headers
    assert_redirected_to login_path

    get login_path, headers: inertia_headers("X-Inertia-Version" => "older")
    assert_reloads login_url

    get login_path, headers: BROWSER
    assert_equal "Invalid email or password", inertia.props.dig(:errors, :email)
  end

  test "a background reload from older assets reloads the page" do
    page = document_mode_path(@document.slug, "edit")
    get page, headers: inertia_headers(
      "X-Inertia-Version" => "older", "X-Inertia-Partial-Component" => "documents/show",
      "X-Inertia-Partial-Data" => "presences"
    )
    assert_reloads document_mode_url(@document.slug, "edit")
  end

  test "a write from older assets is kept and reloads the page" do
    page = document_mode_url(@document.slug, "edit")
    headers = inertia_headers("X-Inertia-Version" => "older", "Referer" => page)
    post identity_path, params: { name: "Guest" }, headers: headers
    assert_redirected_to page
    assert_equal "Guest", session[:display_name]

    get page, headers: headers
    assert_reloads page
  end

  # Production reads the request as HTTPS on the default port; the Referer
  # carries the scheme and host the browser saw.
  test "redirects within the site stay redirects" do
    https!
    host! "thinkroom.example"
    [ "https://thinkroom.example/", "https://THINKROOM.example:443/" ].each do |referer|
      post identity_path, params: { name: "Guest" }, headers: inertia_headers("Referer" => referer)
      assert_response :see_other
      assert_nil response.headers["X-Inertia-Location"]
    end

    delete logout_path, headers: inertia_headers
    assert_response :see_other
    assert_equal "https://thinkroom.example/", response.location
  end

  test "requests are not recorded for the developer tools in any environment" do
    original = Rails.env
    %w[development test production].each do |environment|
      Rails.env = environment
      assert_not InertiaRails.configuration.devtools.enabled?, environment
    end
  ensure
    Rails.env = original
  end

  private

  # The client follows this for every visit. With X-Inertia-Version it would
  # leave the page as it is after an async one.
  def assert_reloads(url)
    assert_response :conflict
    assert_equal url, response.headers["X-Inertia-Location"]
    assert_nil response.headers["X-Inertia-Version"]
  end

  def inertia_headers(headers = {})
    BROWSER.merge("X-Inertia" => "true", "X-Inertia-Version" => InertiaController.safe_vite_digest.to_s, **headers)
  end
end
