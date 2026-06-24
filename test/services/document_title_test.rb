require "test_helper"

class DocumentTitleTest < ActiveSupport::TestCase
  test "extracts the first rendered Markdown H1" do
    title = DocumentTitle.call(
      format: "markdown",
      content: "# First **title**\n\n# Second title\n"
    )

    assert_equal "First title", title
  end

  test "extracts an HTML H1 while ignoring markup" do
    title = DocumentTitle.call(
      format: "html",
      content: "<h1>HTML <span data-provenance>title</span></h1><h1>Later</h1>"
    )

    assert_equal "HTML title", title
  end

  test "returns nil when the document has no nonblank H1" do
    assert_nil DocumentTitle.call(format: "markdown", content: "## Section\n\nBody")
    assert_nil DocumentTitle.call(format: "html", content: "<h1> </h1><p>Body</p>")
  end
end
