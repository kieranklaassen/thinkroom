require "test_helper"

class WritingPassFlowTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper
  include CompoundWritingHelpers

  AI = "compound-writing/cw-ai-check"
  MOM = "compound-writing/cw-mom"
  PARAGRAPHS = [
    { index: 0, kind: "heading", text: "Leverage the report" },
    { index: 1, kind: "paragraph", text: "We should utilize the report to leverage synergies." }
  ].freeze

  setup do
    @document = Document.create!(title: "Doc", seed_markdown: "# Doc")
    @user = featured_user!
    ENV["COMPOUND_WRITING_FAKE_JUDGE"] = "1"
  end

  teardown { ENV.delete("COMPOUND_WRITING_FAKE_JUDGE") }

  def browser = { "User-Agent" => "Mozilla/5.0", "Accept" => "text/html" }

  def post_pass(reviewers: [ MOM ], paragraphs: PARAGRAPHS, slug: @document.slug)
    post document_writing_passes_path(slug), params: { reviewers:, paragraphs: }, as: :json
  end

  def with_env(values)
    previous = ENV.to_h.slice(*values.keys)
    values.each { |key, value| ENV[key] = value }
    yield
  ensure
    values.each_key { |key| ENV.delete(key) }
    ENV.update(previous)
  end

  def partial_reload_headers(*props)
    browser.merge("X-Inertia" => "true", "X-Inertia-Version" => InertiaRails.configuration.version.to_s,
                  "X-Inertia-Partial-Component" => "documents/show", "X-Inertia-Partial-Data" => props.join(","))
  end

  # ----------------------------------------------------------------- gating

  test "a signed-out viewer in Comment mode gets no compound props" do
    get document_mode_path(@document.slug, "comment"), headers: browser

    assert_response :ok
    assert_inertia_props do |props|
      props[:writing_available] == false && !props.key?(:writing_reviewers) && !props.key?(:writing_packs) && !props.key?(:writing_pass)
    end
  end

  test "a signed-in account without the feature gets no compound props either" do
    plain = User.create!(name: "Plain", email: "plain@example.com", password: PASSWORD)
    sign_in_as(plain)

    get document_mode_path(@document.slug, "comment"), headers: browser

    assert_inertia_props { |props| props[:writing_available] == false && !props.key?(:writing_reviewers) }
  end

  test "a featured account in Comment mode gets the lens set, its packs, and the pass" do
    sign_in_as(@user)

    get document_mode_path(@document.slug, "comment"), headers: browser

    assert_response :ok
    assert_inertia_props do |props|
      props[:writing_available] == true &&
        props[:writing_enabled] == true &&
        props[:writing_reviewers].map { |lens| lens[:key] }.include?(AI) &&
        props[:writing_packs].one? && props[:writing_packs].first[:name] == "compound-writing" &&
        props[:writing_packs].first[:source_sha] == "8fd0ec88c00976cf0274cb76552dc7ad9405ca92" &&
        props.key?(:writing_pass) && props[:writing_pass].nil?
    end
  end

  test "the compound route is gone" do
    get "/d/#{@document.slug}/compound", headers: browser

    assert_response :not_found
  end

  test "other modes skip the pass prop until a partial reload asks for it" do
    sign_in_as(@user)
    get document_page_path(@document.slug), headers: browser
    assert_inertia_props { |props| !props.key?(:writing_pass) }

    WritingPass.start!(document: @document, requested_by_name: "A", lenses: compound_lenses("cw-mom"), paragraphs: PARAGRAPHS)
    get document_page_path(@document.slug), headers: partial_reload_headers("writing_pass")

    assert_response :ok
    assert_inertia_props { |props| props.dig(:writing_pass, :status) == "queued" && props.dig(:writing_pass, :reviewer_keys) == [ MOM ] }
  end

  test "a signed-out writer cannot start a pass or dismiss a finding" do
    assert_no_difference -> { WritingPass.count } do
      post_pass
    end
    assert_response :forbidden

    pass = WritingPass.start!(document: @document, requested_by_name: "A", lenses: compound_lenses("cw-mom"), paragraphs: PARAGRAPHS)
    finding = pass.findings.create!(document: @document, reviewer_key: MOM, question_id: "insider", scope: "sentence", probability: 0.9)
    patch dismiss_writing_finding_path(finding), as: :json
    assert_response :forbidden
    assert_nil finding.reload.dismissed_at
  end

  # ------------------------------------------------------------------- runs

  test "a featured writer starts a pass: 303, one pass, one job per lens, one activity, lens snapshot" do
    sign_in_as(@user)

    assert_enqueued_jobs 2, only: WritingReviewerJob do
      assert_difference -> { @document.writing_passes.count } => 1, -> { @document.activities.count } => 1 do
        post document_writing_passes_path(@document.slug), params: {
          reviewers: [ "compound-writing/cw-hemingway", AI ], paragraphs: PARAGRAPHS, requested_by_name: "Quiet Falcon"
        }, as: :json
      end
    end

    assert_response :see_other
    pass = @document.writing_passes.last
    assert_equal [ "compound-writing/cw-hemingway", AI ], pass.reviewer_keys
    assert_equal %w[Hemingway], [ pass.lens("compound-writing/cw-hemingway").name ]
    assert_equal "Leverage the report", pass.paragraphs.first["text"]
  end

  test "a lens the account disabled or does not own is refused" do
    sign_in_as(@user)
    @user.user_writing_packs.first.update_disabled!([ MOM ])

    assert_no_difference -> { WritingPass.count } do
      post_pass(reviewers: [ MOM ])
      assert_response :redirect
      assert_match(/unknown or disabled reviewers/, session[:inertia_errors][:writing_pass])

      post_pass(reviewers: [ "other-pack/cw-mom" ])
      assert_response :redirect
    end
  end

  test "oversized documents create nothing and redirect with an error" do
    sign_in_as(@user)
    long = [ { text: (%w[word] * (WritingPass::MAX_WORDS + 1)).join(" ") } ]

    assert_no_difference -> { WritingPass.count } do
      post_pass(paragraphs: long)
    end
    assert_response :redirect
  end

  test "a featured account without document write access is refused" do
    sign_in_as(@user)
    @document.update!(owner_token: "someone-else", owner_name: "Owner", link_access: "view")

    assert_no_difference -> { WritingPass.count } do
      post_pass
    end
    assert_response :locked
  end

  test "an unconfigured server refuses to run and says so" do
    sign_in_as(@user)
    previous = ENV.to_h.slice("COMPOUND_WRITING_FAKE_JUDGE", "TYPESAFE_API_KEY")
    ENV.delete("COMPOUND_WRITING_FAKE_JUDGE")
    ENV.delete("TYPESAFE_API_KEY")
    assert_not CompoundWriting.enabled?

    assert_no_difference -> { WritingPass.count } do
      post document_writing_passes_path(@document.slug), params: { reviewers: [ MOM ], paragraphs: PARAGRAPHS }
    end
    ENV.update(previous)
    assert_response :redirect
    assert_equal "Reviewers are not configured on this server", session[:inertia_errors][:writing_pass]
  end

  test "a second run while the first is still being judged is refused with a message" do
    sign_in_as(@user)
    post_pass
    assert_response :see_other

    assert_no_difference -> { WritingPass.count } do
      post_pass(reviewers: [ "compound-writing/cw-nemesis" ])
    end
    assert_response :redirect
    assert_match(/already running/, session[:inertia_errors][:writing_pass])
  end

  test "an identical rerun of a finished pass is a notice, not a new pass" do
    sign_in_as(@user)
    post_pass
    pass = @document.writing_passes.last
    pass.record_run!(MOM, status: "finished", findings_count: 0)
    pass.update!(finished_at: 2.minutes.ago, created_at: 3.minutes.ago)

    assert_no_difference -> { WritingPass.count } do
      post_pass
    end
    assert_response :redirect
    assert_equal "Nothing has changed since the last run; the findings are current.", session[:inertia_errors][:writing_pass_notice]
    assert_equal pass, @document.writing_passes.reload.last
  end

  test "a failed pass can be rerun with the same text and reviewers" do
    sign_in_as(@user)
    post_pass
    pass = @document.writing_passes.last
    pass.record_run!(MOM, status: "failed", error: "boom")
    pass.update!(finished_at: 2.minutes.ago, created_at: 3.minutes.ago)

    assert_difference -> { WritingPass.count }, 0 do # replaced, not added
      post_pass
    end
    assert_response :see_other
    assert_not_equal pass.id, @document.writing_passes.reload.last.id
  end

  # ------------------------------------------------------------------- caps

  def document_cap_key(document = @document) = "writing-pass-document-daily:#{Time.now.utc.to_date.iso8601}:#{document.id}"

  test "the per-document daily cap answers 429 with a message and counts only started passes" do
    sign_in_as(@user)
    with_env("COMPOUND_WRITING_DOCUMENT_DAILY_PASSES" => "1") do
      post_pass
      assert_response :see_other
      assert_equal 1, WriteRateLimited::STORE.read(document_cap_key)

      post_pass(reviewers: [ "compound-writing/cw-nemesis" ])
      assert_response :too_many_requests
      assert_equal "This document has reached today's limit of 1 reviewer runs. Try again tomorrow.", response.body
      assert_equal 1, WriteRateLimited::STORE.read(document_cap_key), "a refused attempt is not counted"

      other = Document.create!(title: "Other", seed_markdown: "# Other")
      post_pass(slug: other.slug)
      assert_response :see_other, "another document has its own daily counter"
    end
  end

  test "the daily window is a fixed UTC day, so a refused attempt cannot extend the lockout" do
    sign_in_as(@user)
    with_env("COMPOUND_WRITING_DOCUMENT_DAILY_PASSES" => "1") do
      post_pass
      assert_response :see_other
      post_pass(reviewers: [ "compound-writing/cw-nemesis" ])
      assert_response :too_many_requests

      travel_to Time.now.utc.end_of_day + 1.minute do
        @document.writing_passes.destroy_all
        post_pass(reviewers: [ "compound-writing/cw-nemesis" ])
        assert_response :see_other, "the next UTC day starts a fresh counter"
      end
    end
  end

  test "the per-address daily cap answers 429 with a message across documents" do
    sign_in_as(@user)
    with_env("COMPOUND_WRITING_IP_DAILY_PASSES" => "1") do
      post_pass
      assert_response :see_other

      other = Document.create!(title: "Other", seed_markdown: "# Other")
      assert_no_difference -> { WritingPass.count } do
        post_pass(slug: other.slug)
      end
      assert_response :too_many_requests
      assert_equal "This address has reached today's limit of 1 reviewer runs. Try again tomorrow.", response.body
    end
  end

  test "attempts refused for access or the gate do not count against the caps" do
    with_env("COMPOUND_WRITING_DOCUMENT_DAILY_PASSES" => "1") do
      2.times { post_pass }
      assert_response :forbidden
      assert_nil WriteRateLimited::STORE.read(document_cap_key)

      sign_in_as(@user)
      @document.update!(owner_token: "someone-else", owner_name: "Owner", link_access: "view")
      post_pass
      assert_response :locked
      assert_nil WriteRateLimited::STORE.read(document_cap_key)

      @document.update!(owner_token: nil, owner_name: nil, link_access: "edit")
      post_pass
      assert_response :see_other, "the writer still has today's budget"
      assert_equal 1, WriteRateLimited::STORE.read(document_cap_key)
    end
  end

  test "a pass over the question budget is refused before anything is enqueued" do
    sign_in_as(@user)
    with_env("COMPOUND_WRITING_MAX_NOULS_PER_PASS" => "2") do
      assert_no_enqueued_jobs only: WritingReviewerJob do
        post_pass(reviewers: [ AI ])
      end
    end
    assert_response :redirect
    assert_match(/Switch off some reviewers or review a shorter document/, session[:inertia_errors][:writing_pass])
  end

  # --------------------------------------------------------------- findings

  test "dismissing a finding hides it; a featured account without write access cannot" do
    sign_in_as(@user)
    pass = WritingPass.start!(document: @document, requested_by_name: "A", lenses: compound_lenses("cw-mom"), paragraphs: PARAGRAPHS)
    finding = pass.findings.create!(document: @document, reviewer_key: MOM, question_id: "insider", scope: "sentence", probability: 0.9)

    patch dismiss_writing_finding_path(finding), as: :json
    assert_response :see_other
    assert finding.reload.dismissed_at.present?

    other = pass.findings.create!(document: @document, reviewer_key: MOM, question_id: "insider", scope: "sentence", probability: 0.9)
    @document.update!(owner_token: "someone-else", owner_name: "Owner", link_access: "view")
    patch dismiss_writing_finding_path(other), as: :json
    assert_response :locked
    assert_nil other.reload.dismissed_at
  end
end
