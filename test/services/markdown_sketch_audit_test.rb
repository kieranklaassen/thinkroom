require "test_helper"

class MarkdownSketchAuditTest < ActiveSupport::TestCase
  # A SketchData wrapper that ThinkroomSketch.parse recognizes (a real
  # excalidraw scene with a text label).
  def valid_fence(description: "Approval flow", label: "Draft")
    payload = {
      id: "flow1", formatVersion: 1, description:, height: 260,
      scene: { type: "excalidraw", version: 2, elements: [ { type: "text", text: label } ] }
    }
    "```excalidraw\n#{JSON.generate(payload)}\n```"
  end

  test "recognizes a valid sketch fence" do
    result = MarkdownSketchAudit.call("Before\n\n#{valid_fence}\n\nAfter")

    assert_equal 1, result.fence_count
    assert_equal 0, result.unrecognized_count
    refute result.unrecognized?
  end

  test "flags the documented-but-wrong shape as unrecognized" do
    # The exact failure from the issue: top-level `version` (not formatVersion)
    # and a scene that is not a full excalidraw export.
    payload = { version: 1, id: "x", description: "nope", scene: { elements: [] } }
    fence = "```excalidraw\n#{JSON.generate(payload)}\n```"

    result = MarkdownSketchAudit.call(fence)

    assert_equal 1, result.fence_count
    assert_equal 1, result.unrecognized_count
    assert result.unrecognized?
  end

  test "treats malformed JSON in the fence as unrecognized" do
    result = MarkdownSketchAudit.call("```excalidraw\n{not valid json\n```")

    assert_equal 1, result.fence_count
    assert result.unrecognized?
  end

  test "treats a fence missing the scene key as unrecognized" do
    fence = "```excalidraw\n#{JSON.generate({ formatVersion: 1, id: "x" })}\n```"

    result = MarkdownSketchAudit.call(fence)

    assert_equal 1, result.fence_count
    assert result.unrecognized?
  end

  test "ignores a non-excalidraw code block that merely holds a scene key" do
    fence = "```json\n#{JSON.generate({ formatVersion: 1, scene: { type: "excalidraw" } })}\n```"

    result = MarkdownSketchAudit.call(fence)

    assert_equal 0, result.fence_count
    refute result.unrecognized?
  end

  test "counts each fence independently when valid and invalid are mixed" do
    bad = "```excalidraw\n#{JSON.generate({ version: 1, scene: {} })}\n```"
    content = "#{valid_fence}\n\nText between\n\n#{bad}"

    result = MarkdownSketchAudit.call(content)

    assert_equal 2, result.fence_count
    assert_equal 1, result.unrecognized_count
    assert result.unrecognized?
  end

  test "reports nothing for content with no fences or blank content" do
    assert_equal 0, MarkdownSketchAudit.call("# Just prose\n\nNo sketches here.").fence_count
    refute MarkdownSketchAudit.call("# Just prose").unrecognized?

    blank = MarkdownSketchAudit.call("")
    assert_equal 0, blank.fence_count
    refute blank.unrecognized?
    refute MarkdownSketchAudit.call(nil).unrecognized?
  end

  test "recognition matches what DocumentPlainText renders" do
    # The audit's contract: unrecognized? is true exactly when plain_text would
    # leave raw scene JSON visible instead of the semantic summary.
    good = valid_fence
    bad = "```excalidraw\n#{JSON.generate({ version: 1, scene: {} })}\n```"

    refute MarkdownSketchAudit.call(good).unrecognized?
    assert_includes DocumentPlainText.call(format: "markdown", content: good), "Sketch: Approval flow"

    assert MarkdownSketchAudit.call(bad).unrecognized?
    bad_plain_text = DocumentPlainText.call(format: "markdown", content: bad)
    assert_includes bad_plain_text, %("version") # raw scene JSON leaks through
    refute_includes bad_plain_text, "Sketch:"
  end
end
