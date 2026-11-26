require "test_helper"

# Document and save content stays out of the log, at every level production can
# be set to. Each test drives a real entry point with marker text and searches
# the whole captured log for it in plain, Base64, and hex form.
class LogContentTest < ActionDispatch::IntegrationTest
  include CompoundWritingHelpers
  include ActiveJob::TestHelper

  MARK = "Zq7MarkerWx9Kv"
  # A marker inside a longer Base64 run has one of three alignments; the outer
  # characters that depend on its neighbours are dropped.
  FORMS = [
    MARK, MARK.unpack1("H*"),
    *3.times.map { |pad| Base64.strict_encode64("#{"x" * pad}#{MARK}")[(pad.zero? ? 0 : 4)..-5].delete("=") }
  ].freeze
  LARGE = "#{MARK} " * (1_900_000 / (MARK.length + 1))
  BROWSER = { "User-Agent" => "Mozilla/5.0" }.freeze
  AGENT = { "X-Agent-Name" => "Scout" }.freeze

  # Stands in for the socket only; commands, channels, and broadcasts are real.
  class FakeSocket
    attr_accessor :open
    attr_reader :frames

    def initialize
      @open = true
      @frames = Queue.new
    end

    def alive? = open
    def possible? = true
    def close(...) = self.open = false
    def transmit(frame) = frames << frame
    def rack_response = [ -1, {}, [] ]
    def protocol = nil
  end

  setup do
    @document = Document.create!(title: MARK, seed_content: "# #{MARK}", owner_name: "Owner")
  end

  # Runs the block once per level on a fresh log; the log must be free of the
  # marker and, at debug, must hold what was not meant to be filtered.
  def assert_no_content_logged(keeps: [])
    %i[info debug].each do |level|
      log = capture_log(level) { yield level }
      FORMS.each do |form|
        line = log.each_line.find { |text| text.include?(form) }
        assert_nil line&.byteslice(0, 400)&.scrub, "#{level} log holds #{form}"
      end
      Array(keeps).each { |kept| assert_match kept, log, "#{level} log lost #{kept}" }
    end
  end

  def capture_log(level)
    io = StringIO.new
    capture = ActiveSupport::Logger.new(io, level:)
    others = Rails.logger.broadcasts.dup
    previous = Rails.logger.level
    others.each { |logger| Rails.logger.stop_broadcasting_to(logger) }
    Rails.logger.broadcast_to(capture)
    Rails.logger.level = level
    yield
    io.string
  ensure
    Rails.logger.stop_broadcasting_to(capture)
    others.each { |logger| Rails.logger.broadcast_to(logger) }
    Rails.logger.level = previous
  end

  def update_with(text)
    ydoc = Y::Doc.new
    ydoc.get_text("t") << text
    [ Base64.strict_encode64(ydoc.encode_state_as_update), Base64.strict_encode64(ydoc.encode_state_vector) ]
  end

  def connect_cable
    env = Rack::MockRequest.env_for("/cable", "HTTP_HOST" => "localhost")
    connection = ApplicationCable::Connection.new(ActionCable.server, env)
    socket = FakeSocket.new
    connection.instance_variable_set(:@websocket, socket)
    [ connection, socket ]
  end

  def send_frame(connection, frame)
    ActionCable.server.worker_pool.invoke(
      connection, :dispatch_websocket_message, frame.is_a?(String) ? frame : frame.to_json, connection:
    )
  end

  def identifier(channel = "SyncChannel", **params)
    { channel:, slug: @document.slug, **params }.to_json
  end

  def cable_message(id, **data) = { command: "message", identifier: id, data: data.to_json }

  # Broadcasts are delivered on the cable server's own threads.
  def wait_for_frame(socket)
    Timeout.timeout(10) do
      loop do
        frame = socket.frames.pop
        break frame if yield(frame)
      end
    end
  end

  test "large saves over HTTP" do
    update, state_vector = update_with(LARGE)
    assert_operator update.bytesize, :>, 2_000_000

    assert_no_content_logged(keeps: [ /Parameters: .*#{@document.slug}/, /"generation" => 0/, /"cid" => "tab-1"/ ]) do
      post document_sync_update_path(@document.slug), as: :json, headers: BROWSER, params: {
        update:, updates: [ update, [ update ], { part: update } ], state_vector:, generation: 0, cid: "tab-1",
        content: LARGE, spans: [ { text: MARK, kind: "ai", state: "pending" } ], render_hints: { mermaid: { MARK => 1 } }
      }
      assert_response :no_content
      post document_snapshot_path(@document.slug), as: :json, headers: BROWSER, params: {
        content: "# #{MARK}\n#{LARGE}", spans: [ { text: MARK } ], state_vector:, agent_name: "Scout"
      }
      assert_response :success
      get document_page_path(@document.slug, format: :json)
      assert_response :success
    end
    assert_equal "seeded", @document.reload.seed_state
  end

  test "saves over the sync channel" do
    update, = update_with(LARGE)
    oversized = Base64.strict_encode64(LARGE * 3)

    assert_no_content_logged do |level|
      connection, socket = connect_cable
      id = identifier(sv: Base64.strict_encode64(MARK), cid: "tab-#{level}")
      send_frame(connection, command: "subscribe", identifier: id)
      meta = identifier("DocumentMetaChannel")
      send_frame(connection, command: "subscribe", identifier: meta)
      wait_for_frame(socket) { |frame| frame.include?("confirm_subscription") && frame.include?("MetaChannel") }

      send_frame(connection, cable_message(id, type: "update", update:, updates: [ update ], cid: "tab", seq: 1, generation: 0))
      wait_for_frame(socket) { |frame| frame.include?('"type":"update"') }
      send_frame(connection, cable_message(id, type: "update", update: oversized, cid: "tab", seq: 2, generation: 0))
      send_frame(connection, cable_message(id, type: "update", update: Base64.strict_encode64(MARK), seq: 3, generation: 0))
      send_frame(connection, cable_message(id, type: "awareness", update: Base64.strict_encode64(MARK), cid: "tab"))
      send_frame(connection, cable_message(id, action: "missing", update: MARK))
      DocumentMetaChannel.broadcast_event(@document, :title, title: MARK)
      wait_for_frame(socket) { |frame| frame.include?('"title"') }

      # A second tab joins and is sent the stored state.
      late, late_socket = connect_cable
      send_frame(late, command: "subscribe", identifier: identifier)
      wait_for_frame(late_socket) { |frame| frame.include?('"type":"sync"') }

      send_frame(connection, command: "unsubscribe", identifier: id)
      send_frame(connection, command: "unsubscribe", identifier: meta)
      send_frame(late, command: "unsubscribe", identifier: identifier)
    end
    assert_equal "seeded", @document.reload.seed_state
  end

  test "cable frames that cannot be processed" do
    update, = update_with(LARGE)

    assert_no_content_logged(keeps: /Could not execute command .*RuntimeError/) do
      connection, socket = connect_cable
      send_frame(connection, cable_message(identifier(sv: MARK), type: "update", update:))
      send_frame(connection, command: "unsubscribe", identifier: identifier(sv: MARK))
      send_frame(connection, command: MARK, identifier: identifier, data: MARK)
      send_frame(connection, command: "subscribe", identifier: MARK)
      send_frame(connection, command: "subscribe", identifier:)
      send_frame(connection, command: "message", identifier:, data: MARK)
      send_frame(connection, "#{MARK} is not JSON")
      send_frame(connection, [ MARK ].to_json)
      send_frame(connection, command: "unsubscribe", identifier:)
      socket.open = false
      send_frame(connection, cable_message(identifier, type: "update", update:))
    end
  end

  test "failed merges and unsubscribes on the sync channel" do
    update, = update_with(MARK)

    assert_no_content_logged(keeps: /SyncChannel: merge failed: RuntimeError/) do
      connection, = connect_cable
      send_frame(connection, command: "subscribe", identifier:)
      [ RuntimeError, ArgumentError ].each do |error|
        failing(YjsPersistence, :merge_bytes, error) do
          send_frame(connection, cable_message(identifier, type: "update", update:, seq: 1, generation: 0))
        end
      end
      failing(YjsPersistence, :fold!, RuntimeError) do
        send_frame(connection, command: "unsubscribe", identifier:)
      end
      assert_raises(RuntimeError) do
        ActiveSupport::Notifications.instrument("merge.yjs", document_id: 1) { raise MARK }
      end
    end
  end

  def failing(target, name, error)
    original = target.method(name)
    target.define_singleton_method(name) { |*, **| raise error, MARK }
    yield
  ensure
    target.define_singleton_method(name, original)
  end

  test "comments, suggestions, and reviews from the browser" do
    user = featured_user!
    sign_in_as(user)
    ENV["COMPOUND_WRITING_FAKE_JUDGE"] = "1"

    assert_no_content_logged(keeps: [ /"reviewers" => \["compound-writing/, /Comment/ ]) do |level|
      post document_comments_path(@document.slug), headers: BROWSER, params: { body: MARK, anchor_text: MARK, comment: { body: MARK } }
      post document_suggestions_path(@document.slug), as: :json, headers: BROWSER,
           params: { body: MARK, anchor_text: MARK, replaces: MARK, intent: MARK }
      patch accept_suggestion_path(@document.suggestions.last), headers: BROWSER
      patch resolve_comment_path(@document.comments.last), headers: BROWSER
      perform_enqueued_jobs do
        post document_writing_passes_path(@document.slug), as: :json, headers: BROWSER, params: {
          reviewers: [ "compound-writing/cw-ai-check" ],
          paragraphs: [ { index: 0, kind: "paragraph", text: "We leverage #{MARK} to utilize #{level}." } ]
        }
      end
      assert_equal 1, WritingPass.where(document: @document).count, response.parsed_body.to_s.first(300)
      WritingPass.where(document: @document).find_each { |pass| pass.record_run!("compound-writing/cw-ai-check", status: "failed", error: MARK) }
      WritingPass.where(document: @document).destroy_all
      post documents_path, headers: BROWSER, params: { title: MARK, content: LARGE }
      post documents_path, headers: BROWSER, params: { title: MARK, markdown: MARK }
      patch document_tags_path(@document.slug), as: :json, params: { tags: [ MARK ] }
    end
  ensure
    ENV.delete("COMPOUND_WRITING_FAKE_JUDGE")
  end

  test "agent and CLI endpoints" do
    assert_no_content_logged(keeps: [ /"format" => "html"|as JSON/, /"status" => "active"/ ]) do
      post api_docs_path, as: :json, headers: AGENT, params: { title: MARK, content: LARGE }
      assert_response :created
      slug = response.parsed_body.fetch("slug")
      post api_docs_path, as: :json, headers: AGENT, params: { title: MARK, format: "html", content: "<p>#{MARK}</p>" }
      patch api_doc_path(slug), as: :json, headers: AGENT, params: { title: MARK, replaces: "#{MARK} none", with: MARK }
      patch api_doc_path(slug), as: :json, headers: AGENT, params: { content: MARK }
      post api_doc_suggestions_path(slug), as: :json, headers: AGENT, params: { body: MARK, replaces: MARK, anchor_text: MARK, intent: MARK }
      post api_doc_comments_path(slug), as: :json, headers: AGENT, params: { body: MARK, anchor_text: MARK }
      post api_doc_presence_path(slug), as: :json, headers: AGENT, params: { status: "active", location: MARK }
      get api_doc_path(slug), headers: AGENT
      get api_doc_pending_events_path(slug), headers: AGENT
      # Field names the API does not take, as a caller might guess them.
      post api_docs_path, as: :json, headers: AGENT, params: { document: { source: LARGE }, text: MARK, unknown: LARGE }
    end
  end

  # As in production: the error page shows no details.
  def without_error_details
    key = "action_dispatch.show_detailed_exceptions"
    previous = Rails.application.env_config[key]
    Rails.application.env_config[key] = false
    yield
  ensure
    Rails.application.env_config[key] = previous
  end

  test "bodies that are not the expected form or JSON" do
    json = { title: MARK, content: "#{MARK} see https://example.com/?a=1&b=#{MARK} &c=#{MARK}" }.to_json

    without_error_details do
      assert_no_content_logged do
        form = "application/x-www-form-urlencoded"
        post api_docs_path, params: json, headers: AGENT.merge("CONTENT_TYPE" => form)
        post api_docs_path, params: "#{MARK} one & two=#{MARK}", headers: AGENT.merge("CONTENT_TYPE" => form)
        post api_docs_path, params: MARK, headers: AGENT.merge("CONTENT_TYPE" => "text/markdown")
        post api_docs_path, params: [ MARK, { content: MARK } ].to_json, headers: AGENT.merge("CONTENT_TYPE" => "application/json")
        post api_docs_path, params: MARK, headers: AGENT.merge("CONTENT_TYPE" => "application/json")
        assert_response :bad_request
        post api_docs_path, params: %({"content": "#{LARGE}), headers: AGENT.merge("CONTENT_TYPE" => "application/json")
        post document_comments_path(@document.slug), params: "body=#{MARK}%FF", headers: BROWSER.merge("CONTENT_TYPE" => form)
        assert_response :bad_request
        post document_comments_path(@document.slug), params: "body=#{MARK}%zz", headers: BROWSER.merge("CONTENT_TYPE" => form)
        get "/?content=#{MARK}%FF"
      end
    end
  end

  test "multipart text, query strings, and redirect locations" do
    boundary = "logboundary"
    parts = { "content" => MARK, "file" => MARK, "document[body]" => MARK }.map do |name, value|
      "--#{boundary}\r\nContent-Disposition: form-data; name=\"#{name}\"\r\n\r\n#{value}\r\n"
    end.join
    file = "--#{boundary}\r\nContent-Disposition: form-data; name=\"archive\"; filename=\"#{MARK}.txt\"\r\nContent-Type: text/plain\r\n\r\n#{MARK}\r\n"
    multipart = AGENT.merge("CONTENT_TYPE" => "multipart/form-data; boundary=#{boundary}")

    assert_no_content_logged(keeps: /mode=read/) do
      post api_docs_path, params: "#{parts}#{file}--#{boundary}--\r\n", headers: multipart
      post api_uploads_path, params: "#{parts}--#{boundary}--\r\n", headers: multipart
      get "/?mode=read&content=#{MARK}&doc%5Bbody%5D=#{MARK}&paragraphs%5B%5D%5Btext%5D=#{MARK}&title=#{MARK}"
      post document_comments_path(@document.slug), params: { body: MARK },
           headers: BROWSER.merge("Referer" => "http://www.example.com/d/#{@document.slug}?mode=read&text=#{MARK}&a%5Bcontent%5D=#{MARK}")
      assert_response :redirect
    end
  end

  test "review job failures" do
    judge = Class.new { def judge(**) = raise(RuntimeError, MARK) }.new
    refusing = Class.new { def judge(**) = raise(CompoundWriting::JudgeError.new(MARK, reviewer_key: "x")) }.new

    assert_no_content_logged(keeps: [ /crashed on pass \d+: RuntimeError/, /failed on pass \d+/ ]) do
      [ judge, refusing ].each do |current|
        CompoundWriting.judge = current
        pass = WritingPass.start!(
          document: @document, requested_by_name: "A", lenses: compound_lenses("cw-ai-check"),
          paragraphs: [ { index: 0, kind: "paragraph", text: "We leverage #{MARK} again." } ]
        )
        WritingReviewerJob.perform_now(pass.id, "compound-writing/cw-ai-check")
        assert_includes pass.reload.reviewer_runs.values.first["error"], MARK
        pass.destroy!
      end
    end
  ensure
    CompoundWriting.judge = nil
  end

  test "messages stored by the database cable adapter" do
    ActiveRecord::Base.connection.create_table(:solid_cable_messages) do |t|
      t.binary :channel, null: false
      t.binary :payload, null: false
      t.datetime :created_at, null: false
      t.integer :channel_hash, limit: 8, null: false
    end

    SolidCable::Message.reset_column_information

    assert_no_content_logged do
      assert_difference -> { SolidCable::Message.count } do
        SolidCable::Message.broadcast("sync", { update: LARGE, title: MARK }.to_json)
      end
    end
  ensure
    ActiveRecord::Base.connection.drop_table(:solid_cable_messages, if_exists: true)
  end

  test "server rendering failures" do
    config = InertiaRails::Configuration.default
    config.ssr_raise_on_error = false
    config.on_ssr_error = InertiaRails.configuration.on_ssr_error
    renderer = InertiaRails::SSRRenderer.new(config, page: { component: "documents/show", props: {} })

    assert_no_content_logged(keeps: /documents\/show render failed: InertiaRails::SSRError/) do
      renderer.send(:handle_error, InertiaRails::SSRError.new(%("#{MARK}" is not valid JSON)))
    end
  end

  test "model request bodies stay out of the RubyLLM log" do
    assert_equal false, RubyLLM.config.log_bodies
  end

  test "names that only resemble content fields are still logged" do
    filter = ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters)
    kept = %w[slug id ids mode format content_format content_type content_generation generation status access locked
              archived updated_at created_at seq cid client_id last_event_id document_id reviewers
              kind index intent_id context link_access profile metadata outcome by update_bytes query with_lock]
    kept.each { |name| assert_equal "kept", filter.filter(name => "kept")[name], name }

    masked = %w[update updates state state_vector sv content markdown html text title body anchor_text replaces with
                quote spans paragraphs seed_content content_snapshot provenance_spans password email token secret]
    masked.each { |name| assert_equal "[FILTERED]", filter.filter(name => "x")[name], name }
  end

  test "filtering leaves what the app reads and stores unchanged" do
    post document_comments_path(@document.slug), params: { body: MARK, anchor_text: LARGE.first(300) }, headers: BROWSER
    comment = @document.comments.reload.last
    assert_equal [ MARK, LARGE.first(300).strip ], [ comment.body, comment.anchor_text.strip ]
    assert_equal MARK, @document.reload.title
    assert_not_includes @document.full_inspect, MARK
    assert_includes @document.full_inspect, @document.slug
  end
end
