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

  test "trusted snapshots preserve valid highlighter spans" do
    source = %(<span data-highlighter data-color="yellow">marked</span>)

    result = HtmlDocumentSanitizer.snapshot(source)

    assert_includes result.content, "marked"
    assert_match(/data-highlighter/, result.content)
    assert_match(/data-color="yellow"/, result.content)
  end

  test "trusted snapshots strip highlighter spans with unknown colors" do
    source = %(<span data-highlighter data-color="chartreuse">marked</span>)

    result = HtmlDocumentSanitizer.snapshot(source)

    assert_includes result.content, "marked"
    refute_match(/data-highlighter|data-color/, result.content)
  end

  test "external html cannot forge highlighter spans" do
    source = %(<span data-highlighter data-color="yellow">forged highlight</span>)

    result = HtmlDocumentSanitizer.external(source)

    assert_includes result.content, "forged highlight"
    refute_match(/data-highlighter|data-color/, result.content)
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
    source = %(<figure data-thinkroom-sketch data-sketch-id="flow_1" data-sketch-height="440" data-format-version="1" data-description="Flow" data-scene="#{CGI.escapeHTML(scene)}"><figcaption>Flow</figcaption></figure>)

    trusted = HtmlDocumentSanitizer.snapshot(source).content
    external = HtmlDocumentSanitizer.external(source).content

    assert_includes trusted, "data-thinkroom-sketch"
    assert_includes trusted, "data-scene="
    assert_includes trusted, 'data-sketch-height="440"'
    assert_includes trusted, "<figcaption>Flow</figcaption>"
    refute_match(/data-thinkroom-sketch|data-sketch-height|data-scene|data-description|data-format-version/, external)
    assert_includes external, "<figcaption>Flow</figcaption>"
  end

  test "trusted snapshots reject sketch heights outside the paper limits" do
    scene = { type: "excalidraw", version: 2, elements: [], appState: {}, files: {} }.to_json
    source = %(<figure data-thinkroom-sketch data-sketch-id="too_tall" data-sketch-height="1201" data-format-version="1" data-scene="#{CGI.escapeHTML(scene)}"><figcaption>Visible fallback</figcaption></figure>)

    result = HtmlDocumentSanitizer.snapshot(source).content

    refute_match(/data-thinkroom-sketch|data-sketch-height|data-scene/, result)
    assert_includes result, "Visible fallback"
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

  test "drops every DROP_WITH_CONTENT element with its subtree in both external and snapshot modes" do
    source = [
      "<p>before</p>",
      "<script>drop_script</script>",
      "<style>drop_style</style>",
      "<iframe src=\"https://example.com\">drop_iframe</iframe>",
      "<object data=\"x\">drop_object</object>",
      "<embed src=\"x\">",
      "<template><p>drop_template</p></template>",
      "<svg><style>drop_svg_style</style><text>drop_svg</text></svg>",
      "<div><math><mi>drop_math</mi></math></div>",
      "<p>after</p>"
    ].join

    [ HtmlDocumentSanitizer.external(source), HtmlDocumentSanitizer.snapshot(source) ].each do |result|
      assert result.changed?
      assert_equal "<p>before</p><p>after</p>", result.content
      HtmlDocumentSanitizer::DROP_WITH_CONTENT.each do |tag|
        refute_includes result.content, "<#{tag}"
      end
      refute_match(/drop_/, result.content)
    end
  end

  test "canonicalizes HTML5 nesting and stays idempotent when unwrapping button-scope barriers inside p" do
    source = "<p><button><table><tr><td>x</td></tr></table></button></p>"
    expected = "<p></p><table><tbody><tr><td>x</td></tr></tbody></table><p></p>"

    [ :external, :snapshot ].each do |mode|
      first = HtmlDocumentSanitizer.public_send(mode, source)
      second = HtmlDocumentSanitizer.public_send(mode, first.content)

      assert_equal expected, first.content
      assert first.changed?
      assert_equal expected, second.content
      assert_not second.changed?
    end
  end

  test "strips comments, processing instructions, and escapes CDATA while scrubbing href escaping" do
    source = %(<p><!-- secret --><?pi hidden?><![CDATA[cd <tag>]]><a href='https://example.com/a "b"'>link</a></p>)

    result = HtmlDocumentSanitizer.external(source)

    assert_includes result.content, "link</a>"
    assert_includes result.content, 'href="https://example.com/a%20%22b%22"'
    refute_includes result.content, "secret"
    refute_includes result.content, "hidden"
    refute_includes result.content, "<tag>"
  end

  test "snapshot_fragment runs optional pre-scrub block and returns a scrubbed Nokogiri fragment" do
    source = '<pre lang="mermaid" onclick="evil()"><code>graph TD</code></pre><script>bad()</script>'

    fragment = HtmlDocumentSanitizer.snapshot_fragment(source) do |parsed|
      parsed.at_css("pre")["data-language"] = "mermaid"
    end

    assert_kind_of Nokogiri::HTML5::DocumentFragment, fragment
    assert_equal '<pre data-language="mermaid"><code>graph TD</code></pre>', fragment.to_html
  end

  test "drops foreign-namespace and raw-text mXSS payloads with their content" do
    source = <<~HTML
      <p>safe</p>
      <svg><p><style><a id="</style><img src=x onerror=alert(1)>"></style></p></svg>
      <math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;"></table></mtext></math>
      <noscript><img src="https://evil.example/x.png" onerror="alert(1)"></noscript>
      <a href="java&#x09;script:alert(1)">bad</a>
    HTML

    result = HtmlDocumentSanitizer.external(source)

    assert result.changed?
    assert_includes result.content, "<p>safe</p>"
    assert_includes result.content, "<a>bad</a>"
    refute_match(/svg|math|style|onerror|alert|evil\.example|javascript/i, result.content)
  end

  test "reports changed? accurately for empty, canonical, and modified html" do
    empty = HtmlDocumentSanitizer.snapshot("")
    assert_equal "", empty.content
    assert_not empty.changed?

    canonical = HtmlDocumentSanitizer.snapshot("<p>Already <strong>clean</strong>.</p>")
    assert_equal "<p>Already <strong>clean</strong>.</p>", canonical.content
    assert_not canonical.changed?

    modified = HtmlDocumentSanitizer.snapshot("<p onclick=\"evil()\">Cleaned</p>")
    assert_equal "<p>Cleaned</p>", modified.content
    assert modified.changed?
  end

  test "removes images with missing or blank src and normalizes css-commented table alignment" do
    source = <<~HTML
      <p><img alt="missing"><img src="   " alt="blank"><img src="/rails/active_storage/disk/tok/pic.png" alt="ok"></p>
      <table><tbody><tr><td style="/* comment */ text-align: LEFT;">cell</td></tr></tbody></table>
      <p style="text-align: center">ignored</p>
    HTML

    result = HtmlDocumentSanitizer.snapshot(source)
    fragment = Nokogiri::HTML5.fragment(result.content)

    assert_equal 1, fragment.css("img").length
    assert_equal "/rails/active_storage/disk/tok/pic.png", fragment.at_css("img")["src"]
    assert_equal "text-align: left", fragment.at_css("td")["style"]
    assert_nil fragment.css("p")[1]["style"]
  end
end
