require "test_helper"

# What a page load may ask of the database and how often it may parse a source.
# These costs grow with an account and a document's history, so they are easy
# to add back without noticing.
class DocumentPageCostTest < ActionDispatch::IntegrationTest
  BROWSER = { "User-Agent" => "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" }.freeze
  HEAVY_COLUMNS = %w[yjs_state content_markdown seed_markdown provenance_spans].freeze

  def inertia_headers(only: nil, component: nil)
    headers = BROWSER.merge("X-Inertia" => "true", "X-Inertia-Version" => InertiaController.safe_vite_digest.to_s)
    headers.merge!("X-Inertia-Partial-Component" => component, "X-Inertia-Partial-Data" => only) if only
    headers
  end

  def queries_during
    queries = []
    subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") do |*, payload|
      queries << payload[:sql] unless payload[:name] == "SCHEMA" || payload[:sql].match?(/\A(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i)
    end
    yield
    queries
  ensure
    ActiveSupport::Notifications.unsubscribe(subscriber)
  end

  def count_calls(klass, name)
    original = klass.method(name)
    calls = 0
    klass.define_singleton_method(name) do |*args, **options, &block|
      calls += 1
      original.call(*args, **options, &block)
    end
    yield
    calls
  ensure
    klass.define_singleton_method(name, original)
  end

  def sign_in
    @user = User.create!(name: "Owner", email: "owner@example.com", password: "correct horse battery")
    post login_path, params: { email: @user.email, password: "correct horse battery" }, headers: BROWSER
  end

  def fill_home
    12.times do |i|
      document = Document.create!(title: "Page #{i}", user: @user, seed_content: "# Page #{i}", tags: [ "T#{i}" ],
                                  archived_at: (Time.current if i % 4 == 3))
      DocumentPin.create!(document:, user: @user) if i.even?
    end
    3.times do |i|
      shared = Document.create!(title: "Shared #{i}", seed_content: "# S", owner_token: "someone-else")
      get document_page_path(shared.slug), headers: inertia_headers
    end
  end

  test "the home page reads only listed columns in a fixed number of queries" do
    sign_in
    fill_home
    get root_path, headers: inertia_headers # caches schema lookups

    few = queries_during { get root_path, headers: inertia_headers }
    assert_response :success
    assert_equal 5, few.size, few.join("\n")
    few.each do |sql|
      assert_no_match(/"documents"\.\*|#{HEAVY_COLUMNS.join("|")}/, sql)
    end

    fill_home
    more = queries_during { get root_path, headers: inertia_headers }
    assert_equal few.size, more.size, more.join("\n")
  end

  test "the home page still lists, counts, pins and archives the same pages" do
    sign_in
    fill_home
    get root_path, headers: inertia_headers
    props = response.parsed_body["props"]

    assert_equal 9, props["yours_count"]
    assert_equal 3, props["archived_count"]
    assert_equal 9, props["yours"].size
    assert_equal 3, props["recent"].size
    pins = DocumentPin.joins(:document).where(user: @user, documents: { archived_at: nil }).order(created_at: :desc, id: :desc)
    assert_equal pins.map { |pin| [ pin.document.slug, pin.created_at.iso8601 ] },
                 props["pinned"].map { |row| row.values_at("slug", "pinned_at") }
    assert(props["pinned"].all? { |row| row["yours"] && row["can_write"] })

    get root_path, headers: inertia_headers(component: "documents/index", only: "archived")
    assert_equal 3, response.parsed_body.dig("props", "archived").size
  end

  test "a first visitor without pages or pins gets an empty home page" do
    get root_path, headers: inertia_headers
    props = response.parsed_body["props"]
    assert_equal [ 0, 0, [], [] ], props.values_at("yours_count", "archived_count", "pinned", "yours")
  end

  test "a document page parses its source once and a live-event reload not at all" do
    document = Document.create!(title: "Parsed", seed_content: "# Parsed\n\nBody text.", seed_state: "seeded")
    path = document_page_path(document.slug)
    get path, headers: BROWSER # warms the preview cache

    assert_equal 1, count_calls(Commonmarker, :to_html) { get path, headers: BROWSER }
    assert_select "meta[property='og:title'][content='Parsed']"
    assert_select "meta[property='og:description'][content='Body text.']"
    assert_select "template#agent-guide"

    reload = inertia_headers(component: "documents/show", only: "comments")
    assert_equal 0, count_calls(Commonmarker, :to_html) { get path, headers: reload }
    assert_equal [], response.parsed_body.dig("props", "comments")
  end

  test "folding pending updates reloads the document once under its lock" do
    document = Document.create!(title: "Tail", seed_state: "seeded")
    ydoc = Y::Doc.new
    text = ydoc.get_text("t")
    3.times do |i|
      before = ydoc.encode_state_vector
      text << "edit#{i} "
      document.yjs_document_updates.create!(content_generation: 0, payload: ydoc.encode_state_as_update(before))
    end

    queries = queries_during { YjsPersistence.state_b64(document) }
    assert_equal 1, queries.count { |sql| sql.start_with?('SELECT "documents".*') }, queries.join("\n")
    assert_not document.yjs_document_updates.exists?
  end
end
