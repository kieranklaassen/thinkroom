require "test_helper"

# The HTTP-side seed grant: documents#show atomically claims the seed for a
# fresh document so the editor applies its template from props instead of
# waiting for the SyncChannel round-trip. The channel path keeps the same
# claim (delegated to Document#try_claim_seed) as the stale-claim fallback.
class DocumentSeedClaimTest < ActionDispatch::IntegrationTest
  setup do
    @document = Document.create!(title: "Fresh", seed_markdown: "# Template")
  end

  test "first HTML page load of a stateless doc gets the seed grant" do
    get document_page_path(@document.slug), headers: browser

    assert_response :ok
    assert_inertia_props do |props|
      props[:document][:seed_granted] == true &&
        props[:document][:seed_markdown] == "# Template"
    end
    assert_equal "claimed", @document.reload.seed_state
  end

  test "second page load while the claim is fresh gets no grant" do
    get document_page_path(@document.slug), headers: browser
    get document_page_path(@document.slug), headers: browser

    assert_inertia_props do |props|
      props[:document][:seed_granted] == false
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

  def browser
    { "User-Agent" => "Mozilla/5.0" }
  end
end
