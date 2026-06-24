require "test_helper"

class BrandingTest < ActionDispatch::IntegrationTest
  test "application metadata identifies Thinkroom" do
    get root_path

    assert_response :success
    assert_includes response.body, "<title data-inertia>Thinkroom</title>"
    assert_includes response.body, '<meta name="application-name" content="Thinkroom">'
    assert_includes response.body, '/icon.svg?v=thinkroom'
    refute_includes response.body, ">Pruf<"
  end

  test "both production hostnames serve the application" do
    [ "thinkroom.kieranklaassen.com", "pruf.kieranklaassen.com" ].each do |hostname|
      host! hostname
      get root_path

      assert_response :success
      assert_includes response.body, "Thinkroom"
    end
  end

  test "web app manifest carries the Thinkroom identity" do
    get "/manifest.json"

    assert_response :success
    assert_equal "application/manifest+json", response.media_type
    manifest = JSON.parse(response.body)
    assert_equal "Thinkroom", manifest["name"]
    assert_equal "Thinkroom", manifest["short_name"]
    assert_includes manifest["description"], "deeper thinking"
    assert manifest.fetch("icons").all? { |icon| icon.fetch("src").end_with?("?v=thinkroom") }
  end
end
