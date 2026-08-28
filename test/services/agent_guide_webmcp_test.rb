require "test_helper"

class AgentGuideWebmcpTest < ActiveSupport::TestCase
  BASE_URL = "https://thinkroom.test"
  CHROME_NAME_PATTERN = /\A[A-Za-z0-9_.-]{1,128}\z/
  UNTRUSTED_TOOLS = %w[
    thinkroom_read_document thinkroom_poll_events thinkroom_resolve_comment
    thinkroom_comment thinkroom_propose_suggestion thinkroom_create_document
    thinkroom_announce_presence
  ].freeze
  TRUSTED_TOOLS = %w[thinkroom_guide thinkroom_ack_events].freeze

  setup do
    @document = Document.create!(title: "Shared Doc", seed_markdown: "# Hello\n\nA paragraph about provenance.")
    @manifest = AgentGuide.webmcp_tools(@document, BASE_URL)
    @tools = @manifest[:tools]
    @endpoints = AgentGuide.endpoints(@document, BASE_URL)
  end

  test "every endpoint is a WebMCP tool or explicitly excluded with a reason" do
    @endpoints.each_key do |key|
      covered = AgentGuide::WEBMCP_TOOLS.key?(key)
      excluded = AgentGuide::WEBMCP_EXCLUDED_ENDPOINTS[key.to_s]
      assert covered || excluded.present?, "endpoint #{key} is neither a WebMCP tool nor excluded with a reason"
      refute covered && excluded, "endpoint #{key} is both a WebMCP tool and excluded"
    end
    AgentGuide::WEBMCP_TOOLS.each_key do |key|
      assert @endpoints.key?(key), "WEBMCP_TOOLS references unknown endpoint #{key}"
    end
  end

  test "request tools mirror their endpoint's method, url, body keys, and purpose" do
    request_tools = @tools.select { |tool| tool[:kind] == "request" }
    assert_equal AgentGuide::WEBMCP_TOOLS.size, request_tools.size

    AgentGuide::WEBMCP_TOOLS.each do |key, entry|
      tool = find_tool(entry[:name])
      endpoint = @endpoints.fetch(key)
      assert_equal endpoint[:method], tool[:request][:method], "#{key} method"
      assert_equal endpoint[:url], tool[:request][:url], "#{key} url"
      body_keys = (endpoint[:body] || {}).keys.map(&:to_s)
      tool[:request][:body_params].each do |param|
        assert_includes body_keys, param, "#{key} body_param #{param} is not an endpoint body key"
      end
      refute_includes tool[:request][:body_params], "agent_name", "#{key} must lift agent_name to the header"
      first_sentence = endpoint[:purpose].split(/(?<=[.!?])\s+/).first
      assert tool[:description].start_with?(first_sentence),
             "#{key} description should start with #{first_sentence.inspect}, got #{tool[:description].inspect}"
    end
  end

  test "request tools expose the endpoint's burst rate-limit window when present" do
    assert_equal 600, find_tool("thinkroom_propose_suggestion")[:request][:rate_limit_window_seconds]
    assert_equal 600, find_tool("thinkroom_create_document")[:request][:rate_limit_window_seconds]
    refute find_tool("thinkroom_read_document")[:request].key?(:rate_limit_window_seconds)
    refute find_tool("thinkroom_poll_events")[:request].key?(:rate_limit_window_seconds)
  end

  test "names and descriptions fit Chrome's guardrails on both manifests" do
    [ @tools, AgentGuide.webmcp_index_tools(BASE_URL)[:tools] ].each do |tools|
      names = tools.map { |tool| tool[:name] }
      assert_equal names.uniq, names, "tool names must be unique per manifest"
      tools.each do |tool|
        assert_match CHROME_NAME_PATTERN, tool[:name]
        assert_operator tool[:name].length, :<=, 30, "#{tool[:name]} exceeds 30 chars"
        assert_operator tool[:description].length, :<=, 500, "#{tool[:name]} description exceeds 500 chars"
        assert_equal "object", tool[:input_schema][:type]
        assert_equal false, tool[:input_schema][:additionalProperties]
        tool[:input_schema][:properties].each do |property, schema|
          assert schema[:description].present?, "#{tool[:name]}.#{property} has no description"
          assert_operator schema[:description].length, :<=, 150, "#{tool[:name]}.#{property} description exceeds 150 chars"
        end
        tool[:input_schema][:required].each do |property|
          assert tool[:input_schema][:properties].key?(property.to_sym), "#{tool[:name]} requires unknown property #{property}"
        end
      end
    end
  end

  test "the document page registers exactly the R6 tool set" do
    assert_equal %w[
      thinkroom_guide thinkroom_read_document thinkroom_propose_suggestion thinkroom_comment
      thinkroom_resolve_comment thinkroom_announce_presence thinkroom_poll_events thinkroom_ack_events
      thinkroom_create_document
    ].sort, @tools.map { |tool| tool[:name] }.sort
    assert_equal "#{BASE_URL}/d/#{@document.slug}", @manifest[:share_url]
  end

  test "propose_suggestion requires identity and body, caps body in bytes, and names edit access" do
    tool = find_tool("thinkroom_propose_suggestion")
    assert_equal %w[agent_name body], tool[:input_schema][:required].sort
    assert_equal "required", tool[:request][:agent_identity]
    body = tool[:input_schema][:properties][:body]
    assert_equal Suggestion::MAX_BODY_BYTES, body[:maxLength]
    assert_includes body[:description], "UTF-8 bytes"
    assert_equal Suggestion::MAX_INTENT_BYTES, tool[:input_schema][:properties][:intent][:maxLength]
    assert_equal Suggestion::MAX_ANCHOR_BYTES, tool[:input_schema][:properties][:anchor_text][:maxLength]
    assert_match(/edit link/, tool[:description])
    assert_match(/423/, tool[:description])
    assert_match(/next_action/, tool[:description])
  end

  test "comment and resolve_comment name comment access" do
    %w[thinkroom_comment thinkroom_resolve_comment].each do |name|
      tool = find_tool(name)
      assert_match(/comment or edit link/, tool[:description], name)
      assert_match(/423/, tool[:description], name)
      assert_equal "required", tool[:request][:agent_identity], name
      assert_includes tool[:input_schema][:required], "agent_name", name
    end
  end

  test "read_document is a read-only, identity-free tool with viewer context" do
    tool = find_tool("thinkroom_read_document")
    assert_equal true, tool[:annotations][:read_only_hint]
    assert_equal true, tool[:annotations][:untrusted_content_hint]
    assert_equal "omit", tool[:request][:agent_identity]
    assert_equal true, tool[:include_viewer_context]
    assert_empty tool[:input_schema][:required]
    refute tool[:input_schema][:properties].key?(:agent_name)
  end

  test "guide is a static, read-only tool with viewer context and no document text" do
    tool = find_tool("thinkroom_guide")
    assert_equal "static", tool[:kind]
    assert_equal true, tool[:annotations][:read_only_hint]
    assert_equal true, tool[:include_viewer_context]
    assert tool[:static_text].present?
    refute tool.key?(:request)
    assert_includes tool[:static_text], "WebMCP"
    assert_includes tool[:static_text], "X-Agent-Name"
  end

  test "untrusted_content_hint follows the threat model" do
    UNTRUSTED_TOOLS.each do |name|
      assert_equal true, find_tool(name)[:annotations][:untrusted_content_hint], name
    end
    TRUSTED_TOOLS.each do |name|
      assert_equal false, find_tool(name)[:annotations][:untrusted_content_hint], name
    end
  end

  test "every non-read-only tool requires agent identity with a bounded agent_name" do
    @tools.each do |tool|
      next if tool[:kind] == "static"

      if tool[:annotations][:read_only_hint]
        assert_equal "omit", tool[:request][:agent_identity], tool[:name]
      else
        assert_equal "required", tool[:request][:agent_identity], tool[:name]
        agent_name = tool[:input_schema][:properties][:agent_name]
        assert_equal "string", agent_name[:type]
        assert_equal 1, agent_name[:minLength]
        assert_equal 255, agent_name[:maxLength]
        assert_includes tool[:input_schema][:required], "agent_name"
      end
    end
  end

  test "resolve_comment moves id into the URL" do
    tool = find_tool("thinkroom_resolve_comment")
    assert_equal [ "id" ], tool[:request][:path_params]
    assert_includes tool[:request][:url], ":id"
    assert_includes tool[:input_schema][:required], "id"
    assert_empty tool[:request][:body_params]
  end

  test "request URLs stay under same-origin /api and never target cli or uploads" do
    request_tools = @tools.select { |tool| tool[:kind] == "request" }
    assert request_tools.any?
    request_tools.each do |tool|
      url = tool[:request][:url]
      assert url.start_with?("#{BASE_URL}/api/"), "#{tool[:name]} url #{url}"
      refute url.start_with?("#{BASE_URL}/api/cli"), "#{tool[:name]} url #{url}"
      refute_equal "#{BASE_URL}/api/uploads", url, tool[:name]
    end
    names = @tools.map { |tool| tool[:name] }
    refute_includes names, "thinkroom_update_document"
    refute_includes names, "thinkroom_list_documents"
  end

  test "create_document caps content in bytes and needs no link access" do
    tool = find_tool("thinkroom_create_document")
    content = tool[:input_schema][:properties][:content]
    assert_equal Document::MAX_CONTENT_BYTES, content[:maxLength]
    assert_includes content[:description], "UTF-8 bytes"
    assert_equal %w[html markdown], tool[:input_schema][:properties][:format][:enum].sort
    assert_equal "required", tool[:request][:agent_identity]
    assert_match(/unclaimed draft/, tool[:description])
  end

  test "manifest strings never embed document content, titles, or comments" do
    title = "INJECT <script>"
    text_marker = "ZEBRA-PLAINTEXT-MARKER"
    comment_marker = "OCELOT-COMMENT-MARKER"
    document = Document.create!(title:, seed_markdown: "# #{title}\n\nBody with #{text_marker} inside.")
    document.comments.create!(author_name: "A", author_kind: "human", body: "Please #{comment_marker}", anchor_text: "Body")
    assert_includes document.plain_text, text_marker

    strings = collect_strings(AgentGuide.webmcp_tools(document, BASE_URL))
    assert strings.any?
    strings.each do |string|
      refute_includes string, title
      refute_includes string, text_marker
      refute_includes string, comment_marker
    end
  end

  test "suggestion wording follows the document's content format" do
    markdown_tool = find_tool("thinkroom_propose_suggestion")
    assert_match(/Markdown/, markdown_tool[:input_schema][:properties][:body][:description])
    refute_match(/HTML/, markdown_tool[:input_schema][:properties][:body][:description])

    html_document = Document.create!(title: "HTML Doc", content_format: "html", seed_content: "<h1>HTML Doc</h1><p>Body</p>")
    html_tool = AgentGuide.webmcp_tools(html_document, BASE_URL)[:tools].find { |tool| tool[:name] == "thinkroom_propose_suggestion" }
    assert_match(/HTML/, html_tool[:input_schema][:properties][:body][:description])
    refute_match(/Markdown/, html_tool[:input_schema][:properties][:body][:description])
  end

  test "index manifest offers exactly guide and create_document without a share_url" do
    manifest = AgentGuide.webmcp_index_tools(BASE_URL)
    refute manifest.key?(:share_url)
    assert_equal %w[thinkroom_create_document thinkroom_guide], manifest[:tools].map { |tool| tool[:name] }.sort

    guide = manifest[:tools].find { |tool| tool[:name] == "thinkroom_guide" }
    assert_equal "static", guide[:kind]
    assert_equal true, guide[:include_viewer_context]
    assert_includes guide[:static_text], "unclaimed"

    create = manifest[:tools].find { |tool| tool[:name] == "thinkroom_create_document" }
    assert_equal "#{BASE_URL}/api/docs", create[:request][:url]
    assert_equal "POST", create[:request][:method]
    assert_equal "required", create[:request][:agent_identity]
  end

  test "notes mention WebMCP browser tools" do
    notes = AgentGuide.notes(@document)
    assert notes.last.include?("WebMCP"), notes.last
    assert notes.last.include?("thinkroom_*")
    assert notes.last.include?("document updates are not offered")
  end

  private

  def find_tool(name)
    @tools.find { |tool| tool[:name] == name } || flunk("no tool named #{name}")
  end

  def collect_strings(value, acc = [])
    case value
    when String then acc << value
    when Hash then value.each_value { |v| collect_strings(v, acc) }
    when Array then value.each { |v| collect_strings(v, acc) }
    end
    acc
  end
end
