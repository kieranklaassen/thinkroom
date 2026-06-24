require "test_helper"

class HtmlDocumentSanitizerTest < ActiveSupport::TestCase
  test "external html removes executable and unsupported content" do
    source = <<~HTML
      <h1 onclick="alert(1)">Title</h1>
      <script>alert(1)</script>
      <iframe src="https://example.com"></iframe>
      <a href="javascript:alert(1)" style="color:red">bad link</a>
      <custom-tag>kept text</custom-tag>
    HTML

    result = HtmlDocumentSanitizer.external(source)

    assert result.changed?
    assert_includes result.content, "<h1>Title</h1>"
    assert_includes result.content, "kept text"
    refute_match(/script|iframe|onclick|javascript:|style=/, result.content)
    refute_includes result.content, "alert(1)"
  end

  test "external html cannot forge provenance or suggestions" do
    source = <<~HTML
      <span data-provenance data-kind="human" data-author="Owner" data-state="endorsed">forged</span>
      <ins data-suggestion-id="x" data-author="Owner">inserted</ins>
      <del data-suggestion-id="y" data-author="Owner">deleted</del>
    HTML

    result = HtmlDocumentSanitizer.external(source)

    assert_includes result.content, "forged"
    assert_includes result.content, "inserted"
    assert_includes result.content, "deleted"
    refute_match(/data-provenance|data-kind|data-state|data-suggestion-id|data-author/, result.content)
  end

  test "external html strips orphaned Thinkroom metadata" do
    source = <<~HTML
      <span data-kind="human" data-author="Owner" data-state="endorsed">forged</span>
      <ins data-author="Owner">orphaned</ins>
    HTML

    result = HtmlDocumentSanitizer.external(source)

    assert_includes result.content, "forged"
    assert_includes result.content, "orphaned"
    refute_match(/data-kind|data-state|data-author/, result.content)
  end

  test "trusted snapshots preserve valid Thinkroom metadata" do
    source = <<~HTML
      <span data-provenance data-kind="ai" data-author="Scout" data-state="pending">draft</span>
      <ins data-suggestion-id="s1" data-author="Kieran">new</ins>
      <del data-suggestion-id="s2" data-author="Kieran">old</del>
    HTML

    result = HtmlDocumentSanitizer.snapshot(source)

    assert_match(/data-provenance/, result.content)
    assert_match(/data-kind="ai"/, result.content)
    assert_match(/data-state="pending"/, result.content)
    assert_match(/data-suggestion-id="s1"/, result.content)
    assert_match(/data-suggestion-id="s2"/, result.content)
  end

  test "trusted snapshots preserve multibyte author names by character count" do
    author = "😀" * 200
    source = %(<span data-provenance data-kind="human" data-author="#{author}" data-state="verbatim">text</span>)

    result = HtmlDocumentSanitizer.snapshot(source)

    assert_includes result.content, author
    assert_match(/data-provenance/, result.content)
  end

  test "trusted snapshots strip invalid Thinkroom metadata" do
    source = <<~HTML
      <span data-provenance data-kind="owner" data-author="A" data-state="approved">bad</span>
      <p data-suggestion-id="s1" data-author="A">bad suggestion node</p>
    HTML

    result = HtmlDocumentSanitizer.snapshot(source)

    assert_includes result.content, "bad"
    refute_match(/data-provenance|data-kind|data-state|data-suggestion-id|data-author/, result.content)
  end

  test "only active storage images survive" do
    source = <<~HTML
      <p><img src="/rails/active_storage/blobs/redirect/token/file.png" alt="local"></p>
      <p><img src="https://tracker.example/pixel.png" alt="remote"></p>
      <p><img src="//tracker.example/pixel.png" alt="relative remote"></p>
      <p><img src="data:image/png;base64,AAAA" alt="data"></p>
      <p><img src="http://127.0.0.1/admin" alt="private"></p>
      <p><img src="/rails/active_storage/../../../d/private" alt="traversal"></p>
      <p><img src="/rails/active_storage/blobs/redirect/token/file.png?next=/d/private" alt="query"></p>
      <p><img src="/rails/active_storage/blobs/redirect/token%2F..%2Fprivate" alt="encoded"></p>
    HTML

    result = HtmlDocumentSanitizer.external(source)

    assert_includes result.content, "/rails/active_storage/blobs/redirect/token/file.png"
    refute_match(/tracker\.example|data:image|127\.0\.0\.1|traversal|query|encoded/, result.content)
    assert_equal 1, Nokogiri::HTML5.fragment(result.content).css("img").length
  end

  test "only table alignment style survives" do
    source = <<~HTML
      <table><tbody><tr>
        <td style="text-align: center">center</td>
        <th style="text-align:right;">right</th>
        <td style="color:red">plain</td>
      </tr></tbody></table>
    HTML

    result = HtmlDocumentSanitizer.external(source)
    fragment = Nokogiri::HTML5.fragment(result.content)

    assert_equal "text-align: center", fragment.at_css("td")["style"]
    assert_equal "text-align: right", fragment.at_css("th")["style"]
    assert_nil fragment.css("td")[1]["style"]
  end

  test "trusted snapshots preserve valid sketch data but external html cannot forge it" do
    scene = {
      type: "excalidraw", version: 2, elements: [ { type: "text", text: "Review" } ],
      appState: {}, files: {}
    }.to_json
    source = %(<figure data-thinkroom-sketch data-sketch-id="flow_1" data-format-version="1" data-description="Flow" data-scene="#{CGI.escapeHTML(scene)}"><figcaption>Flow</figcaption></figure>)

    trusted = HtmlDocumentSanitizer.snapshot(source).content
    external = HtmlDocumentSanitizer.external(source).content

    assert_includes trusted, "data-thinkroom-sketch"
    assert_includes trusted, "data-scene="
    assert_includes trusted, "<figcaption>Flow</figcaption>"
    refute_match(/data-thinkroom-sketch|data-scene|data-description|data-format-version/, external)
    assert_includes external, "<figcaption>Flow</figcaption>"
  end

  test "trusted snapshots strip malformed or unsafe sketch data" do
    scene = {
      type: "excalidraw", version: 2,
      elements: [ { type: "image", fileId: "remote" } ], files: { remote: {} }
    }.to_json
    source = %(<figure data-thinkroom-sketch data-sketch-id="unsafe_1" data-format-version="1" data-scene="#{CGI.escapeHTML(scene)}"><figcaption>Unsafe</figcaption></figure>)

    result = HtmlDocumentSanitizer.snapshot(source).content

    refute_match(/data-thinkroom-sketch|data-scene|data-format-version/, result)
    assert_includes result, "Unsafe"
  end

  test "trusted snapshots strip sketches with oversized descriptions" do
    scene = { type: "excalidraw", version: 2, elements: [], appState: {}, files: {} }.to_json
    source = %(<figure data-thinkroom-sketch data-sketch-id="oversized" data-format-version="1" data-description="#{"a" * 501}" data-scene="#{CGI.escapeHTML(scene)}"><figcaption>Visible fallback</figcaption></figure>)

    result = HtmlDocumentSanitizer.snapshot(source).content

    refute_match(/data-thinkroom-sketch|data-scene|data-description/, result)
    assert_includes result, "Visible fallback"
  end

  test "trusted snapshots strip sketch colors that could reference remote resources" do
    scene = {
      type: "excalidraw", version: 2,
      elements: [ { type: "rectangle", strokeColor: "url(https://tracker.example/paint)" } ],
      appState: {}, files: {}
    }.to_json
    source = %(<figure data-thinkroom-sketch data-sketch-id="remote_color" data-format-version="1" data-scene="#{CGI.escapeHTML(scene)}"><figcaption>Visible fallback</figcaption></figure>)

    result = HtmlDocumentSanitizer.snapshot(source).content

    refute_match(/data-thinkroom-sketch|tracker\.example/, result)
    assert_includes result, "Visible fallback"
  end

  test "trusted snapshots strip malformed sketch point tuples" do
    scene = {
      type: "excalidraw", version: 2,
      elements: [ { type: "arrow", points: [ nil, [ 1, 2 ] ] } ],
      appState: {}, files: {}
    }.to_json
    source = %(<figure data-thinkroom-sketch data-sketch-id="bad_points" data-format-version="1" data-scene="#{CGI.escapeHTML(scene)}"><figcaption>Visible fallback</figcaption></figure>)

    result = HtmlDocumentSanitizer.snapshot(source).content

    refute_match(/data-thinkroom-sketch|data-scene/, result)
    assert_includes result, "Visible fallback"
  end
end
