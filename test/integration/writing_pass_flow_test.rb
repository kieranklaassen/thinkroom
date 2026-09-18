require "test_helper"

class WritingPassFlowTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  PARAGRAPHS = [
    { index: 0, kind: "heading", text: "Leverage the report" },
    { index: 1, kind: "paragraph", text: "We should utilize the report to leverage synergies." }
  ].freeze

  setup do
    @document = Document.create!(title: "Doc", seed_markdown: "# Doc")
    ENV["COMPOUND_WRITING_FAKE_JUDGE"] = "1"
  end

  teardown { ENV.delete("COMPOUND_WRITING_FAKE_JUDGE") }

  def browser = { "User-Agent" => "Mozilla/5.0", "Accept" => "text/html" }

  test "compound mode is a writer's mode with the registry and pass props" do
    get document_mode_path(@document.slug, "compound"), headers: browser

    assert_response :ok
    assert_inertia_props do |props|
      props.dig(:ui, :mode) == "compound" &&
        props[:writing_enabled] == true &&
        props[:writing_reviewers].map { |reviewer| reviewer[:key] }.include?("hemingway") &&
        props.key?(:writing_pass) && props[:writing_pass].nil?
    end
  end

  test "other modes skip the pass prop until a partial reload asks for it" do
    get document_page_path(@document.slug), headers: browser
    assert_inertia_props { |props| !props.key?(:writing_pass) }

    WritingPass.start!(document: @document, requested_by_name: "A", reviewer_keys: %w[mom], paragraphs: PARAGRAPHS)
    get document_page_path(@document.slug), headers: browser.merge(
      "X-Inertia" => "true", "X-Inertia-Version" => InertiaRails.configuration.version.to_s,
      "X-Inertia-Partial-Component" => "documents/show", "X-Inertia-Partial-Data" => "writing_pass"
    )

    assert_response :ok
    assert_inertia_props { |props| props.dig(:writing_pass, :status) == "queued" && props.dig(:writing_pass, :reviewer_keys) == %w[mom] }
  end

  test "a comment-only link cannot open compound mode" do
    @document.update!(owner_token: "someone-else", owner_name: "Owner", link_access: "comment")

    get document_mode_path(@document.slug, "compound"), headers: browser

    assert_redirected_to document_page_path(@document.slug)
  end

  test "a writer starts a pass: 303, one pass, one job per reviewer, one activity" do
    assert_enqueued_jobs 2, only: WritingReviewerJob do
      assert_difference -> { @document.writing_passes.count } => 1, -> { @document.activities.count } => 1 do
        post document_writing_passes_path(@document.slug), params: {
          reviewers: %w[hemingway ai_check], paragraphs: PARAGRAPHS, requested_by_name: "Quiet Falcon"
        }, as: :json
      end
    end

    assert_response :see_other
    pass = @document.writing_passes.last
    assert_equal %w[hemingway ai_check], pass.reviewer_keys
    assert_equal "Quiet Falcon", pass.requested_by_name
    assert_equal "Leverage the report", pass.paragraphs.first["text"]
  end

  test "unknown reviewers and oversized documents create nothing and redirect with an error" do
    assert_no_difference -> { WritingPass.count } do
      post document_writing_passes_path(@document.slug), params: { reviewers: %w[nope], paragraphs: PARAGRAPHS }, as: :json
      assert_response :redirect

      long = [ { text: (%w[word] * (WritingPass::MAX_WORDS + 1)).join(" ") } ]
      post document_writing_passes_path(@document.slug), params: { reviewers: %w[mom], paragraphs: long }, as: :json
      assert_response :redirect
    end
  end

  test "a view-only viewer is refused" do
    @document.update!(owner_token: "someone-else", owner_name: "Owner", link_access: "view")

    assert_no_difference -> { WritingPass.count } do
      post document_writing_passes_path(@document.slug), params: { reviewers: %w[mom], paragraphs: PARAGRAPHS }, as: :json
    end
    assert_response :locked
  end

  test "an unconfigured server refuses to run and says so" do
    previous = ENV.to_h.slice("COMPOUND_WRITING_FAKE_JUDGE", "TYPESAFE_API_KEY")
    ENV.delete("COMPOUND_WRITING_FAKE_JUDGE")
    ENV.delete("TYPESAFE_API_KEY")
    assert_not CompoundWriting.enabled?

    assert_no_difference -> { WritingPass.count } do
      post document_writing_passes_path(@document.slug), params: { reviewers: %w[mom], paragraphs: PARAGRAPHS }
    end
    ENV.update(previous)
    assert_response :redirect
    assert_equal "Reviewers are not configured on this server", session[:inertia_errors][:writing_pass]
  end

  def post_pass(reviewers: %w[mom], paragraphs: PARAGRAPHS, slug: @document.slug)
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

  test "a second run while the first is still being judged is refused with a message" do
    post_pass
    assert_response :see_other

    assert_no_difference -> { WritingPass.count } do
      post_pass(reviewers: %w[nemesis])
    end
    assert_response :redirect
    assert_match(/already running/, session[:inertia_errors][:writing_pass])
  end

  test "an identical rerun of a finished pass is a notice, not a new pass" do
    post_pass
    pass = @document.writing_passes.last
    pass.record_run!("mom", status: "finished", findings_count: 0)
    pass.update!(finished_at: 2.minutes.ago, created_at: 3.minutes.ago)

    assert_no_difference -> { WritingPass.count } do
      post_pass
    end
    assert_response :redirect
    assert_equal "Nothing has changed since the last run; the findings are current.", session[:inertia_errors][:writing_pass_notice]
    assert_equal pass, @document.writing_passes.reload.last
  end

  def document_cap_key(document = @document) = "writing-pass-document-daily:#{Time.now.utc.to_date.iso8601}:#{document.id}"

  test "the per-document daily cap answers 429 with a message and counts only started passes" do
    with_env("COMPOUND_WRITING_DOCUMENT_DAILY_PASSES" => "1") do
      post_pass
      assert_response :see_other
      assert_equal 1, WriteRateLimited::STORE.read(document_cap_key)

      post_pass(reviewers: %w[nemesis])
      assert_response :too_many_requests
      assert_equal "This document has reached today's limit of 1 reviewer runs. Try again tomorrow.", response.body
      assert_equal 1, WriteRateLimited::STORE.read(document_cap_key), "a refused attempt is not counted"

      other = Document.create!(title: "Other", seed_markdown: "# Other")
      post_pass(slug: other.slug)
      assert_response :see_other, "another document has its own daily counter"
    end
  end

  test "the daily window is a fixed UTC day, so a refused attempt cannot extend the lockout" do
    with_env("COMPOUND_WRITING_DOCUMENT_DAILY_PASSES" => "1") do
      post_pass
      assert_response :see_other
      post_pass(reviewers: %w[nemesis])
      assert_response :too_many_requests

      travel_to Time.now.utc.end_of_day + 1.minute do
        @document.writing_passes.destroy_all
        post_pass(reviewers: %w[nemesis])
        assert_response :see_other, "the next UTC day starts a fresh counter"
      end
    end
  end

  test "attempts refused for access or configuration do not count against the caps" do
    with_env("COMPOUND_WRITING_DOCUMENT_DAILY_PASSES" => "1") do
      @document.update!(owner_token: "someone-else", owner_name: "Owner", link_access: "view")
      2.times { post_pass }
      assert_response :locked
      assert_nil WriteRateLimited::STORE.read(document_cap_key)

      @document.update!(owner_token: nil, owner_name: nil, link_access: "edit")
      previous = ENV.to_h.slice("COMPOUND_WRITING_FAKE_JUDGE", "TYPESAFE_API_KEY")
      ENV.delete("COMPOUND_WRITING_FAKE_JUDGE")
      ENV.delete("TYPESAFE_API_KEY")
      post_pass
      ENV.update(previous)
      assert_response :redirect
      assert_nil WriteRateLimited::STORE.read(document_cap_key)

      post_pass
      assert_response :see_other, "the writer still has today's budget"
      assert_equal 1, WriteRateLimited::STORE.read(document_cap_key)
    end
  end

  test "a failed pass can be rerun with the same text and reviewers" do
    post_pass
    pass = @document.writing_passes.last
    pass.record_run!("mom", status: "failed", error: "boom")
    pass.update!(finished_at: 2.minutes.ago, created_at: 3.minutes.ago)

    assert_difference -> { WritingPass.count }, 0 do # replaced, not added
      post_pass
    end
    assert_response :see_other
    assert_not_equal pass.id, @document.writing_passes.reload.last.id
  end

  test "the per-address daily cap answers 429 with a message across documents" do
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

  test "a pass over the question budget is refused before anything is enqueued" do
    with_env("COMPOUND_WRITING_MAX_NOULS_PER_PASS" => "2") do
      assert_no_enqueued_jobs only: WritingReviewerJob do
        post_pass(reviewers: %w[ai_check])
      end
    end
    assert_response :redirect
    assert_match(/Switch off some reviewers or review a shorter document/, session[:inertia_errors][:writing_pass])
  end

  test "dismissing a finding hides it; a view-only viewer cannot" do
    pass = WritingPass.start!(document: @document, requested_by_name: "A", reviewer_keys: %w[mom], paragraphs: PARAGRAPHS)
    finding = pass.findings.create!(document: @document, reviewer_key: "mom", question_id: "insider", scope: "sentence", probability: 0.9)

    patch dismiss_writing_finding_path(finding), as: :json
    assert_response :see_other
    assert finding.reload.dismissed_at.present?

    other = pass.findings.create!(document: @document, reviewer_key: "mom", question_id: "insider", scope: "sentence", probability: 0.9)
    @document.update!(owner_token: "someone-else", owner_name: "Owner", link_access: "view")
    patch dismiss_writing_finding_path(other), as: :json
    assert_response :locked
    assert_nil other.reload.dismissed_at
  end
end
