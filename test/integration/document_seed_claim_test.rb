require "test_helper"

# The HTTP-side seed grant: documents#show atomically claims the seed for a
# fresh document so the editor applies its template from props instead of
# waiting for the SyncChannel round-trip. The channel path keeps the same
# claim (delegated to Document#try_claim_seed) as the stale-claim fallback.
class DocumentSeedClaimTest < ActionDispatch::IntegrationTest
  include CompoundWritingHelpers

  setup do
    @document = Document.create!(title: "Fresh", seed_markdown: "# Template")
  end

  test "first HTML page load of a stateless doc gets the seed grant" do
    get document_page_path(@document.slug), headers: browser

    assert_response :ok
    assert_inertia_props do |props|
      props[:document][:seed_granted] == true &&
        props[:document][:seed_content] == "# Template" &&
        !props[:document].key?(:seed_markdown) &&
        props[:document][:content_generation] == 0 &&
        props[:document][:content_format] == "markdown"
    end
    assert_equal "claimed", @document.reload.seed_state
  end

  test "after a sign-in the first load's token is refused and the next full load's is accepted" do
    user = User.create!(name: "Owner", email: "owner@example.com", password: PASSWORD)
    with_forgery_protection { get document_page_path(@document.slug), headers: browser }
    first_load_token = page_token
    claim = @document.reload.seed_claim_token
    sign_in_as(user)

    with_forgery_protection do
      post_seed(claim, token: first_load_token)
      assert_response :unprocessable_entity

      get document_page_path(@document.slug), headers: browser
      post_seed(claim, token: page_token)
      assert_response :no_content
    end
  end

  test "the page grant carries the claim, and only with the grant" do
    get document_page_path(@document.slug), headers: browser
    assert_inertia_props { |props| props[:document][:seed_claim] == @document.reload.seed_claim_token }

    get document_page_path(@document.slug), headers: browser
    assert_inertia_props { |props| props[:document][:seed_claim].nil? }
  end

  test "sync_update accepts a superseded claim's seed until another seed is stored" do
    get document_page_path(@document.slug), headers: browser
    claim = @document.reload.seed_claim_token
    travel(Document::SEED_CLAIM_TIMEOUT + 1.second) { assert Document.find(@document.id).try_claim_seed }

    post_seed claim
    assert_response :no_content

    assert_no_difference(-> { YjsDocumentUpdate.count }) { post_seed @document.reload.seed_claim_token }
    assert_response :conflict
    assert_equal true, response.parsed_body["seed_refused"]
  end

  test "HTML page load ships HTML source and format with the seed grant" do
    html = Document.create!(
      title: "HTML",
      content_format: "html",
      seed_content: "<h1>Template</h1><p>Body</p>"
    )

    get document_page_path(html.slug), headers: browser

    assert_inertia_props do |props|
      props[:document][:seed_granted] == true &&
        props[:document][:seed_content] == "<h1>Template</h1><p>Body</p>" &&
        !props[:document].key?(:seed_markdown) &&
        props[:document][:content_format] == "html"
    end
  end

  test "page render ships seed authorship alongside the grant" do
    agent_doc = Document.create!(
      title: "AgentSeed", seed_markdown: "# From an agent",
      seed_author_kind: "agent", seed_author_name: "Scout"
    )

    get document_page_path(agent_doc.slug), headers: browser

    assert_inertia_props do |props|
      props[:document][:seed_granted] == true &&
        props[:document][:seed_author_kind] == "agent" &&
        props[:document][:seed_author_name] == "Scout"
    end
  end

  test "second page load while the claim is fresh gets no grant" do
    get document_page_path(@document.slug), headers: browser
    get document_page_path(@document.slug), headers: browser

    assert_inertia_props do |props|
      props[:document][:seed_granted] == false
    end
  end

  test "a page load without the grant ships no seed template" do
    get document_page_path(@document.slug), headers: browser
    get document_page_path(@document.slug), headers: browser

    assert_inertia_props do |props|
      props[:document][:seed_granted] == false &&
        props[:document][:seed_content].nil? &&
        !props[:document].key?(:seed_markdown)
    end
  end

  test "a stale claim is reclaimable by a later page load" do
    get document_page_path(@document.slug), headers: browser

    travel Document::SEED_CLAIM_TIMEOUT + 1.second do
      get document_page_path(@document.slug), headers: browser
      assert_inertia_props do |props|
        props[:document][:seed_granted] == true
      end
      assert_equal "claimed", @document.reload.seed_state
    end
  end

  test "Inertia partial reloads never touch the seed claim" do
    get document_page_path(@document.slug), headers: browser.merge(
      "X-Inertia" => "true",
      "X-Inertia-Partial-Component" => "documents/show",
      "X-Inertia-Partial-Data" => "presences"
    )

    assert_equal "pending", @document.reload.seed_state,
                 "a partial reload must not burn or refresh the claim"
  end

  test "prefetch-shaped requests never claim the seed" do
    get document_page_path(@document.slug), headers: browser.merge("Sec-Purpose" => "prefetch")
    assert_equal "pending", @document.reload.seed_state

    get document_page_path(@document.slug), headers: browser.merge("Purpose" => "prefetch")
    assert_equal "pending", @document.reload.seed_state
  end

  test "documents with existing state never grant the seed" do
    @document.update!(yjs_state: "x")

    get document_page_path(@document.slug), headers: browser

    assert_inertia_props do |props|
      props[:document][:seed_granted] == false
    end
    assert_equal "pending", @document.reload.seed_state
  end

  test "seed version changes after source replacement at the same slug" do
    get document_page_path(@document.slug), headers: browser
    first_version = nil
    assert_inertia_props do |props|
      first_version = props[:document][:seed_version]
      first_version.present?
    end

    travel 1.second do
      @document.replace_content!(source: "# Replacement")
    end

    get document_page_path(@document.slug), headers: browser
    assert_inertia_props do |props|
      props[:document][:seed_version].present? &&
        props[:document][:seed_version] != first_version &&
        props[:document][:content_generation] == 1 &&
        props[:document][:seed_content] == "# Replacement"
    end
  end

  test "a fresh page load after replacement reflects the replacement even when a stale client tried to resync" do
    @document.update!(yjs_state: "ignored-for-this-http-only-test", content_snapshot: "# Live snapshot")
    @document.replace_content!(source: "# Replacement content")

    # A stale SyncChannel client attempting to resync after the replacement
    # is covered end-to-end in test/channels/sync_channel_test.rb (the
    # generation guard rejects it there). This asserts the HTTP read side of
    # the same invariant: documents#show always reflects the replacement,
    # which only holds because that stale frame was never merged.
    get document_page_path(@document.slug), headers: browser

    assert_inertia_props do |props|
      props[:document][:seed_content] == "# Replacement content" &&
        props[:document][:has_state] == false
    end
  end

  test "the page embeds the Yjs state when it is under the cap" do
    ydoc = Y::Doc.new
    ydoc.get_text("t") << "small state"
    YjsPersistence.merge(@document, Base64.strict_encode64(ydoc.encode_state_as_update))
    YjsPersistence.fold!(@document)

    get document_page_path(@document.slug), headers: browser

    assert_inertia_props do |props|
      props[:document][:has_state] == true &&
        props[:document][:yjs_state_b64] == Base64.strict_encode64(@document.reload.yjs_state) &&
        props[:document][:yjs_state_checksum] == @document.yjs_state_checksum
    end
  end

  test "the page omits a Yjs state larger than the embed cap and leaves it to the handshake" do
    oversized = "\x00".b * (DocumentsController::MAX_EMBEDDED_STATE_BYTES + 1)
    @document.update_columns(
      yjs_state: oversized,
      yjs_state_checksum: Digest::SHA256.hexdigest(oversized),
      seed_state: "seeded"
    )

    get document_page_path(@document.slug), headers: browser

    assert_inertia_props do |props|
      props[:document][:has_state] == true &&
        props[:document][:yjs_state_b64].nil? &&
        props[:document][:yjs_state_checksum].nil? &&
        props[:document][:seed_granted] == false
    end
  end

  test "read-only viewers never burn the seed claim" do
    # A viewer without write access can't send the applied template anywhere
    # (every client write path is canWrite-gated), so granting them the seed
    # would leave the document blank for everyone until the claim timeout.
    @document.update!(owner_token: "owner", owner_name: "Owner", link_access: "view")

    get document_page_path(@document.slug), headers: browser

    assert_response :ok
    assert_inertia_props do |props|
      props[:document][:seed_granted] == false
    end
    assert_equal "pending", @document.reload.seed_state
  end

  %w[view comment].each do |access|
    test "every page a #{access}-only viewer can open leaves the claim for a writer" do
      @document.update!(owner_token: "owner", owner_name: "Owner", link_access: access)

      assert_pages_leave_claim
      sign_in_as User.create!(name: "Guest", email: "guest@example.com", password: PASSWORD)
      assert_pages_leave_claim
    end
  end

  test "a comment-only viewer of an unopened document gets its text and can comment" do
    @document.update!(owner_token: "owner", owner_name: "Owner", link_access: "comment")

    get document_mode_path(@document.slug, "comment"), headers: browser
    assert_inertia_props do |props|
      props[:document][:content_html].include?("Template") && props[:ownership][:can_comment] == true
    end

    assert_difference -> { @document.comments.count } do
      post document_comments_path(@document.slug), params: { body: "First", anchor_text: "Template" }
    end
    assert_equal "pending", @document.reload.seed_state
  end

  test "documents without seed markdown never grant the seed" do
    doc = Document.create!(title: "Blank", seed_markdown: nil)

    get document_page_path(doc.slug), headers: browser

    assert_inertia_props do |props|
      props[:document][:seed_granted] == false
    end
  end

  test "agent and JSON fetches never burn the claim" do
    get "/d/#{@document.slug}", headers: { "User-Agent" => "curl/8.6.0" }
    assert_response :ok
    assert_equal "pending", @document.reload.seed_state

    get "/d/#{@document.slug}", headers: browser.merge("Accept" => "application/json")
    assert_response :ok
    assert_equal "pending", @document.reload.seed_state

    get "/d/#{@document.slug}?format=txt", headers: browser
    assert_response :ok
    assert_equal "pending", @document.reload.seed_state
  end

  # Exercises the conditional-UPDATE guard with two independent record
  # instances loaded before either claim runs. In-process calls can't
  # reproduce a true DB-level race — the WHERE clause's affected-row count
  # is the atomicity authority under real concurrency.
  test "exactly one of two competing claims wins at the model level" do
    first = Document.find(@document.id)
    second = Document.find(@document.id)

    assert_equal [ true, false ], [ first.try_claim_seed, second.try_claim_seed ]
  end

  test "an HTML grant blocks the channel grant while fresh" do
    get document_page_path(@document.slug), headers: browser

    assert_not Document.find(@document.id).try_claim_seed,
               "channel path must not re-grant a freshly claimed seed"
  end

  private

  def assert_pages_leave_claim
    inertia = { "X-Inertia" => "true", "X-Inertia-Version" => InertiaRails.configuration.version.to_s }
    requests = [
      {},
      { "Sec-Purpose" => "prefetch" },
      inertia,
      inertia.merge("X-Inertia-Partial-Component" => "documents/show", "X-Inertia-Partial-Data" => "document"),
      { "User-Agent" => "curl/8.6.0" }
    ]
    paths = [ document_page_path(@document.slug) ] +
      %w[read comment suggest edit].map { |mode| "/d/#{@document.slug}/#{mode}" }
    paths.product(requests).each do |path, headers|
      get path, headers: browser.merge(headers)
      assert_includes [ 200, 301, 303 ], response.status, "#{path} #{headers}"
      assert_equal "pending", @document.reload.seed_state, "#{path} #{headers}"
    end
  end

  def browser
    { "User-Agent" => "Mozilla/5.0" }
  end

  def page_token = css_select("meta[name=csrf-token]").first["content"]

  def with_forgery_protection
    original = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    yield
  ensure
    ActionController::Base.allow_forgery_protection = original
  end

  def post_seed(claim, token: nil)
    ydoc = Y::Doc.new
    ydoc.get_text("t") << "body"
    post "/d/#{@document.slug}/sync_update", as: :json, headers: { "X-CSRF-Token" => token }.compact, params: {
      update: Base64.strict_encode64(ydoc.encode_state_as_update), generation: 0, seed_claim: claim
    }
  end
end
