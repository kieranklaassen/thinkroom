require "test_helper"
require "minitest/mock"

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
    CompoundWriting.stub(:enabled?, false) do
      assert_no_difference -> { WritingPass.count } do
        post document_writing_passes_path(@document.slug), params: { reviewers: %w[mom], paragraphs: PARAGRAPHS }
      end
    end
    assert_response :redirect
    assert_equal "Reviewers are not configured on this server", session[:inertia_errors][:writing_pass]
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
