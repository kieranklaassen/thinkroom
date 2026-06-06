require "test_helper"

# U1: the home page Recent rows carry ownership metadata so claimable docs
# can offer an inline claim affordance, and claiming from the index moves
# the row into "Your docs" via the same race-tolerant claim flow.
class HomeClaimTest < ActionDispatch::IntegrationTest
  setup do
    @document = Document.create!(title: "Agent Made This")
  end

  def establish_identity
    get root_path
    assert_response :success
  end

  def browser
    { "User-Agent" => "Mozilla/5.0" }
  end

  test "recent rows include claimable true for an unclaimed agent-created doc" do
    establish_identity
    get document_page_path(@document.slug), headers: browser # adds to recents

    get root_path
    assert_inertia_props do |props|
      row = props[:recent].find { |d| d[:slug] == @document.slug }
      row && row[:claimable] == true && row[:claimed] == false && row[:yours] == false
    end
  end

  test "recent rows show claimed state and owner name for a doc claimed by another token" do
    establish_identity
    get document_page_path(@document.slug), headers: browser
    Document.where(id: @document.id).update_all(
      owner_token: "someone-else", owner_name: "Winner", claimed_at: Time.current
    )

    get root_path
    assert_inertia_props do |props|
      row = props[:recent].find { |d| d[:slug] == @document.slug }
      row && row[:claimable] == false && row[:claimed] == true &&
        row[:owner_name] == "Winner" && row[:yours] == false
    end
  end

  test "recent rows never include the owner token" do
    establish_identity
    get document_page_path(@document.slug), headers: browser

    get root_path
    refute_match(/owner_token/, response.body)
  end

  test "demo doc row is never claimable" do
    Document.create!(title: "Demo", slug: "demo")
    establish_identity
    get document_page_path("demo"), headers: browser

    get root_path
    assert_inertia_props do |props|
      row = props[:recent].find { |d| d[:slug] == "demo" }
      row && row[:claimable] == false
    end
  end

  test "claiming from the index moves the doc into yours and out of recent" do
    establish_identity
    get document_page_path(@document.slug), headers: browser

    post claim_document_path(@document.slug), params: { name: "Me" }
    assert_response :see_other
    assert @document.reload.claimed?

    get root_path
    assert_inertia_props do |props|
      props[:yours].any? { |d| d[:slug] == @document.slug } &&
        props[:recent].none? { |d| d[:slug] == @document.slug }
    end
  end

  test "lost race from the index surfaces the winner without a server error" do
    establish_identity
    get document_page_path(@document.slug), headers: browser
    Document.where(id: @document.id).update_all(
      owner_token: "someone-else", owner_name: "Winner", claimed_at: Time.current
    )

    post claim_document_path(@document.slug), params: { name: "Loser" }
    assert_response :see_other
    assert_equal "Winner", @document.reload.owner_name

    get root_path
    assert_inertia_props do |props|
      row = props[:recent].find { |d| d[:slug] == @document.slug }
      row && row[:claimed] == true && row[:owner_name] == "Winner"
    end
  end
end
