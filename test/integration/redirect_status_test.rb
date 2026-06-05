require "test_helper"

# Non-GET redirects must be 303 See Other for Inertia: a 302 after PATCH makes
# some clients replay the PATCH against the redirect target, which produced
# `No route matches [PATCH] "/d/:slug"` routing errors in the wild.
class RedirectStatusTest < ActionDispatch::IntegrationTest
  setup do
    @document = Document.create!(title: "Doc", seed_markdown: "# Hello\n\nSome prose to anchor against.")
  end

  test "accepting a suggestion redirects with 303" do
    suggestion = @document.suggestions.create!(
      author_name: "Scout", author_kind: "agent", body: "Better prose.", intent: "Tighten"
    )
    patch "/suggestions/#{suggestion.id}/accept", params: { by: "human" }
    assert_response :see_other
  end

  test "rejecting a suggestion redirects with 303" do
    suggestion = @document.suggestions.create!(
      author_name: "Scout", author_kind: "agent", body: "Other prose.", intent: "Trim"
    )
    patch "/suggestions/#{suggestion.id}/reject"
    assert_response :see_other
  end

  BROWSER = { "User-Agent" => "Mozilla/5.0 (Macintosh) Chrome/126 Safari/537.36" }.freeze

  test "creating a document via the form redirects with 303" do
    post "/documents", params: { title: "New", markdown: "# New" }, headers: BROWSER
    assert_response :see_other
  end

  test "session recents are scoped per session and skip agent fetches" do
    # An agent fetch must NOT record a recent…
    get "/d/#{@document.slug}"
    get "/", headers: BROWSER
    refute_includes response.body, @document.slug

    # …a browser visit must.
    get "/d/#{@document.slug}", headers: BROWSER
    get "/", headers: BROWSER
    assert_includes response.body, @document.slug

    reset! # fresh session sees nothing
    get "/", headers: BROWSER
    refute_includes response.body, @document.slug
  end
end
