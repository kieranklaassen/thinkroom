require "test_helper"

# Document and save content stays out of the application log at info and debug. Each test drives a real entry point with marker text and searches
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
  TAB = "0b9f1c9e-5d1c-4a57-9a43-2f2b1d1f7a10"
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
  # marker and must hold what was not meant to be filtered.
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

    assert_no_content_logged(keeps: [ /Parameters: .*#{@document.slug}/, /"generation" => 0/, /"cid" => "#{TAB}"/ ]) do
      post document_sync_update_path(@document.slug), as: :json, headers: BROWSER, params: {
        update:, updates: [ update, [ update ], { part: update } ], state_vector:, generation: 0, cid: TAB,
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
      send_frame(connection, cable_message(id, action: MARK, MARK => 1))
      send_frame(connection, cable_message(id, MARK => MARK, "#{MARK} key" => { MARK => 1 }, type: MARK, note: MARK))
      DocumentMetaChannel.broadcast_event(@document, :title, title: MARK)
      wait_for_frame(socket) { |frame| frame.include?('"title"') }

      # A second tab joins and is sent the stored state.
      late, late_socket = connect_cable
      send_frame(late, command: "subscribe", identifier: identifier)
      wait_for_frame(late_socket) { |frame| frame.include?('"type":"sync"') }

      send_frame(connection, command: "unsubscribe", identifier: id)
      send_frame(connection, command: "unsubscribe", identifier: meta)
      send_frame(late, command: "unsubscribe", identifier: identifier)
      assert_empty connection.subscriptions.identifiers
      assert_empty late.subscriptions.identifiers
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
      send_frame(connection, command: "subscribe", identifier: identifier(MARK))
      send_frame(connection, command: "subscribe", identifier: identifier("String"))
      send_frame(connection, command: "unsubscribe", identifier: { channel: "SyncChannel", MARK => MARK, note: MARK }.to_json)
      send_frame(connection, command: "unsubscribe", identifier: [ MARK ].to_json)
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

    full = lambda do
      raise SQLite3::FullException, MARK
    rescue SQLite3::FullException
      raise ActiveRecord::StatementInvalid, MARK
    end
    frame = /test\/integration\/log_content_test\.rb:\d+/
    keeps = [ /SyncChannel: merge failed: RuntimeError \| .*#{frame}/, /SyncChannel: undecodable update dropped: ArgumentError \| .*#{frame}/,
              /merge failed: ActiveRecord::StatementInvalid \| caused by SQLite3::FullException \| .*#{frame}/,
              /merge failed: NoMethodError \(undefined method 'missing_method'/,
              /SyncChannel: unsubscribe cleanup failed: RuntimeError \| .*#{frame}/ ]
    assert_no_content_logged(keeps:) do
      connection, = connect_cable
      send_frame(connection, command: "subscribe", identifier:)
      [ RuntimeError, ArgumentError ].each do |error|
        failing(YjsPersistence, :merge_bytes, error) do
          send_frame(connection, cable_message(identifier, type: "update", update:, seq: 1, generation: 0))
        end
      end
      [ full, -> { nil.missing_method } ].each do |body|
        calling(YjsPersistence, :merge_bytes, body) do
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

  def failing(target, name, error, &) = calling(target, name, -> { raise error, MARK }, &)

  def calling(target, name, body)
    original = target.method(name)
    target.define_singleton_method(name) { |*, **| body.call }
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
    assert_no_content_logged(keeps: [ /as JSON/, /"status" => "active"/ ]) do
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
    end
  end

  # Field names the app does not take, as a caller might guess them, and names
  # on the readable list that hold text.
  GUESSED = %w[comment note message summary anchorText seedContent document source text unknown description value
               error query q prompt reply heading label caption id_note with data].freeze

  test "text under any other name, and text as a name" do
    readable = LogContent::READABLE.keys - %w[_method format]
    without_error_details do
      assert_no_content_logged(keeps: [ /"status" => "active"/, /"last_event_id" => 7/ ]) do
        (GUESSED + readable).each_slice(12) do |names|
          [ MARK, "#{MARK} text", LARGE.first(300) ].each do |value|
            params = names.index_with(value)
            post api_docs_path, as: :json, headers: AGENT, params: params
            post api_docs_path, headers: AGENT, params: params
            post api_docs_path, as: :json, headers: AGENT, params: { document: params, list: [ params ], reviewers: [ value, [ value ] ] }
            get "/?#{params.to_query}"
          end
          WriteRateLimited::STORE.clear
        end
        post api_doc_presence_path(@document.slug), as: :json, headers: AGENT, params: { status: "active" }
        post api_doc_ack_events_path(@document.slug), as: :json, headers: AGENT, params: { last_event_id: 7 }
        patch document_tags_path(@document.slug), as: :json, params: { MARK => 1, deep: { MARK => { MARK => true } } }
        form = AGENT.merge("CONTENT_TYPE" => "application/x-www-form-urlencoded")
        post api_docs_path, params: MARK, headers: form
        post api_docs_path, params: "See[the #{MARK}](url)=1&id[#{MARK}]=1", headers: form
        post document_writing_passes_path(@document.slug), params: { MARK => 1 }, headers: BROWSER
        get "/?format=#{MARK}&_method=#{MARK}"
        sign_in_as(featured_user!(email: "#{SecureRandom.hex(4)}@example.com"))
        post document_writing_passes_path(@document.slug), params: { MARK => 1 }, headers: BROWSER
        post signup_path, params: { MARK => 1, "#{MARK} text" => 1 }
        get "/?#{MARK}"
        get "/?mode=read&#{MARK};id=#{MARK}&#{MARK}%20more"
      end
    end
  end

  test "a request without parameters has no parameters line" do
    log = capture_log(:info) { get root_path }
    assert_includes log, "Processing by DocumentsController#index"
    assert_not_includes log, "Parameters:"
  end

  test "text in the shape of other values is masked" do
    masked = { "[FILTERED]" => "[FILTERED]" }
    [ 2**53 + 1, -(2**60), 1.5, MARK.unpack1("H*").hex, MARK.bytes, [ 1 ], [ true ] ].each do |value|
      %w[id ids seq reviewers].each { |name| assert_equal masked, LogContent.redact(name => value), "#{name} #{value}" }
    end
    assert_equal masked, LogContent.redact("reviewers" => [ "compound-writing/cw-a" ] * 21)
    assert_equal masked, LogContent.redact("slug" => "\xFF")
    { "id" => 2**53, "seq" => 0, "locked" => true, "reviewers" => [ "compound-writing/cw-ai-check" ] }.each do |name, value|
      assert_equal({ name => value }, LogContent.redact(name => value))
    end
  end

  class OwnMessage < StandardError
    def message = MARK
    def exception = raise(MARK)
  end

  class Uncopyable < StandardError
    def initialize_clone(*, **) = raise(MARK)
  end

  class RaisingJob < ActiveJob::Base
    cattr_accessor :error
    def perform = raise(self.class.error)
  end

  test "errors that cannot be changed or copied" do
    errors = [ RuntimeError.new(MARK).freeze, OwnMessage.new, Uncopyable.new(MARK) ]
    assert_no_content_logged(keeps: [ /Error performing .*: RuntimeError \(message not logged\)/, /Error performing .*OwnMessage \(/, /Error performing .*Uncopyable: message/ ]) do |level|
      errors.each do |error|
        RaisingJob.error = error
        assert_raises(error.class) { RaisingJob.perform_now } unless error.is_a?(OwnMessage)
        job = RaisingJob.new
        ActiveSupport::Notifications.instrument("perform.active_job", job:, adapter: RaisingJob.queue_adapter, exception_object: error)
        assert_nothing_raised { LogContent.describe(error) }
      end
    end
    assert_equal MARK, errors.first.message
  end

  test "the error page and its copy text keep the message" do
    update, = update_with("text")
    with_env_config("action_dispatch.show_exceptions" => :all, "action_dispatch.show_detailed_exceptions" => true) do
      assert_no_content_logged(keeps: /RuntimeError:/) do
        failing(YjsPersistence, :merge_bytes, RuntimeError) do
          post document_sync_update_path(@document.slug), params: { update:, generation: 0 }, headers: BROWSER
        end
        assert_includes css_select("textarea#exception-message-for-copy").text, "RuntimeError (#{MARK})"
      end
    end
  end

  test "development logs keep error messages" do
    update, = update_with("text")
    previous = Rails.env
    log = capture_log(:info) do
      Rails.env = "development"
      with_env_config("action_dispatch.show_exceptions" => :all) do
        failing(YjsPersistence, :merge_bytes, RuntimeError) do
          post document_sync_update_path(@document.slug), params: { update:, generation: 0 }, headers: BROWSER
        end
      end
      assert_raises(RuntimeError) { SteppingJob.perform_now(MARK.reverse) }
    ensure
      Rails.env = previous
    end
    assert_match(/RuntimeError \(#{MARK}\):/, log)
    assert_match(/Error performing .*RuntimeError \(#{MARK}\)/, log)
  end

  test "upload objects under any part name" do
    assert_no_content_logged do
      %w[file image upload files[] id archive document[file]].each do |name|
        body = "--b\r\nContent-Disposition: form-data; name=\"#{name}\"; filename=\"#{MARK}.txt\"\r\n" \
               "Content-Type: text/plain\r\n\r\n#{MARK}\r\n--b--\r\n"
        post api_uploads_path, params: body, headers: AGENT.merge("CONTENT_TYPE" => "multipart/form-data; boundary=b")
      end
    end
  end

  test "messages of errors nothing handles" do
    update, = update_with("text")
    params = { update:, generation: 0 }
    with_env_config("action_dispatch.show_exceptions" => :all) do
      without_error_details do
        assert_no_content_logged(keeps: [ /RuntimeError:/, %r{^app/controllers/documents_controller\.rb:\d+:in }, /undefined method 'missing_method'/, /Caused by: ActiveRecord::StatementInvalid:/ ]) do
          failing(YjsPersistence, :merge_bytes, RuntimeError) { post document_sync_update_path(@document.slug), as: :json, params: }
          assert_response :internal_server_error
          calling(YjsPersistence, :merge_bytes, -> { nil.missing_method }) { post document_sync_update_path(@document.slug), as: :json, params: }
          nested = lambda do
            raise ActiveRecord::StatementInvalid, "no such table:\nINSERT #{MARK}"
          rescue ActiveRecord::StatementInvalid
            raise IOError, MARK
          end
          calling(YjsPersistence, :merge_bytes, nested) { post document_sync_update_path(@document.slug), as: :json, params: }
          post "/rails/active_storage/blobs/redirect/x/#{MARK}.png"
        end
      end
    end
  end

  class SteppingJob < ActiveJob::Base
    include ActiveJob::Continuable

    def perform(marker) = step(:only) { |_step| raise(marker.reverse) }
  end

  class FailingJob < ActiveJob::Base
    class Retried < StandardError; end
    class Discarded < StandardError; end
    retry_on(Retried, attempts: 2, wait: 0)
    discard_on(Discarded)

    def perform(error, marker) = raise(error.constantize, marker.reverse)
  end

  test "messages of failed jobs and of handled errors" do
    kinds = { "RuntimeError" => /Error performing .*RuntimeError/, "LogContentTest::FailingJob::Retried" => /Retrying .*Retried/,
              "LogContentTest::FailingJob::Discarded" => /Discarded .*Discarded/ }
    assert_no_content_logged(keeps: [ *kinds.values, /Error during step .*RuntimeError/, /Stopped retrying .*Retried/, /rescue_from handled Document::EditingLockedError/ ]) do
      kinds.each_key do |kind|
        perform_enqueued_jobs { FailingJob.perform_later(kind, MARK.reverse) }
      rescue Minitest::UnexpectedError, RuntimeError, FailingJob::Retried
        nil
      end
      [ {}, { wait: 1.minute } ].each do |options|
        refusing = ->(*) { raise ActiveJob::EnqueueError, MARK }
        calling(ActiveJob::Base.queue_adapter, :enqueue, refusing) do
          calling(ActiveJob::Base.queue_adapter, :enqueue_at, refusing) { FailingJob.set(options).perform_later("RuntimeError", MARK.reverse) }
        end
      end
      assert_raises(RuntimeError) { SteppingJob.perform_now(MARK.reverse) }
      calling(YjsPersistence, :merge_bytes, -> { raise Document::EditingLockedError, MARK }) do
        post document_sync_update_path(@document.slug), as: :json, params: { update: "AAA=", generation: 0 }
      end
    end
  end

  # As in production: the error page shows no details.
  def without_error_details(&) = with_env_config("action_dispatch.show_detailed_exceptions" => false, &)

  def with_env_config(settings)
    previous = Rails.application.env_config.slice(*settings.keys)
    Rails.application.env_config.merge!(settings)
    yield
  ensure
    Rails.application.env_config.merge!(previous)
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
      [ "#:~:text=#{MARK}", "?#{MARK}", "?mode=read&#{MARK}", "?id=#{MARK}", "//rails//active_storage/blobs/x/#{MARK}.png", "/rails/active%5Fstorage/x/#{MARK}.png" ].each do |tail|
        post document_comments_path(@document.slug), params: { body: MARK },
             headers: BROWSER.merge("Referer" => "http://www.example.com/d/#{@document.slug}#{tail}")
        assert_response :redirect
      end
    end
  end

  test "review job failures" do
    judge = Class.new { def judge(**) = raise(RuntimeError, MARK) }.new
    refusing = Class.new { def judge(**) = raise(CompoundWriting::JudgeError.new(MARK, reviewer_key: "x")) }.new

    assert_no_content_logged(keeps: [ /crashed on pass \d+: RuntimeError/, /failed on pass \d+: CompoundWriting::JudgeError \| .*log_content_test/ ]) do
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

  test "uploaded file names in storage paths and redirects" do
    image = Tempfile.new([ "pixel", ".png" ], binmode: true)
    image.write(Vips::Image.black(8, 8).write_to_buffer(".png"))
    image.rewind

    assert_no_content_logged(keeps: [ %r{GET "/rails/active_storage/blobs/redirect/\[FILTERED\]"}, %r{GET "/rails/active_storage/disk/\[FILTERED\]"} ]) do
      post api_uploads_path, headers: AGENT, params: { file: Rack::Test::UploadedFile.new(image.path, "image/png", true, original_filename: "#{MARK}.png") }
      assert_response :created
      get response.parsed_body.fetch("src")
      assert_response :redirect
      get response.location
      assert_response :success
      without_error_details do
        with_env_config("action_dispatch.show_exceptions" => :all) do
          %w[blobs/x representations/x/y blobs/proxy/x representations/redirect/x/y disk/x unknown].each do |route|
            get "/rails/active_storage/#{route}/#{MARK}.png"
            get "//rails//active_storage//#{route}//#{MARK}.png"
            get "/rails/active%5Fstorage/#{route}/#{MARK}.png"
            post "/rails/active_storage/#{route}/#{MARK}.png"
          end
        end
      end
    end
  ensure
    image&.close!
  end

  test "server rendering failures" do
    config = InertiaRails::Configuration.default
    config.ssr_raise_on_error = false
    config.on_ssr_error = InertiaRails.configuration.on_ssr_error
    config.ssr_bundle = nil
    failures = [ InertiaRails::SSRError.new(%("#{MARK}" is not valid JSON), type: "render"), Net::ReadTimeout.new(MARK) ]

    assert_no_content_logged(keeps: [ /render failed: render$/, /documents\/show render failed: .*Net::ReadTimeout/ ]) do
      failures.each do |failure|
        renderer = InertiaRails::SSRRenderer.new(config, page: { component: "documents/show", props: {} })
        renderer.define_singleton_method(:request) { raise failure }
        assert_nil renderer.render
      end
    end
  end

  test "model request bodies stay out of the RubyLLM log" do
    assert_equal false, RubyLLM.config.log_bodies
  end

  # A new column that holds text must be added to the list that masks it.
  SHOWN_COLUMNS = %w[
    action actor_kind author_kind checksum client_session_id content_format content_type cursor_agent_id
    cursor_agent_url cursor_pr_url cursor_run_id cursor_status description google_uid key kind link_access metadata
    paragraphs_digest question_id record_type resolved_by scope seed_author_kind slug source_kind source_locator
    source_ref source_sha status value variation_digest version
  ].freeze

  test "text columns are masked in binds and inspect" do
    connection = ActiveRecord::Base.connection
    columns = connection.tables.flat_map { |table| connection.columns(table) }
    text = columns.select { |column| %i[string text json binary].include?(column.type) }.map(&:name).uniq
    shown = text.reject { |name| ActiveRecord::Base.inspection_filter.filter_param(name, "x").to_s == "[FILTERED]" }
    assert_equal SHOWN_COLUMNS, shown.sort
    assert_equal "[FILTERED]", ActiveRecord::Base.inspection_filter.filter_param(nil, "x").to_s

    others = (columns.map(&:name) - text).uniq
    assert_equal others, others.reject { |name| ActiveRecord::Base.inspection_filter.filter_param(name, "x").to_s == "[FILTERED]" }
  end

  test "messages that are not hashes are sent as they are, without their debug line" do
    stream = SyncChannel.broadcasting_for(@document)
    connection, socket = connect_cable
    channel = SyncChannel.new(connection, identifier, { slug: @document.slug })
    [ MARK, nil, [ MARK ], [ [ "a", MARK ] ], 7 ].each do |message|
      assert_no_content_logged do
        broadcasts = capture_broadcasts_raw(stream) { SyncChannel.broadcast_to(@document, message) }
        assert_equal [ ActiveSupport::JSON.encode(message) ], broadcasts
        channel.send(:transmit, message)
        assert_includes socket.frames.pop, %("message":#{message.to_json})
      end
    end
    hash = { type: "update", "update" => MARK, nested: { a: [ 1 ] } }
    channel.send(:transmit, hash)
    assert_equal hash.as_json, ActiveSupport::JSON.decode(socket.frames.pop)["message"]
  end

  def capture_broadcasts_raw(stream)
    sent = []
    subscriber = ActiveSupport::Notifications.subscribe("broadcast.action_cable") do |event|
      sent << event.payload[:coder].encode(event.payload[:message]) if event.payload[:broadcasting] == stream
    end
    yield
    sent
  ensure
    ActiveSupport::Notifications.unsubscribe(subscriber)
  end

  test "an override of a method that a gem no longer has stops the boot" do
    replacement = Module.new { def perform_gone(data) = super }
    gone = assert_raises(RuntimeError) { LogContent.override(Class.new, replacement) }
    assert_match(/perform_gone no longer exists.*config\/initializers\/log_content\.rb/, gone.message)
    changed = assert_raises(RuntimeError) { LogContent.override(Class.new { def perform_gone = nil }, replacement) }
    assert_match(/perform_gone now takes \[\] \(#{Regexp.escape(__FILE__)}:\d+\)/, changed.message)
    keywords = Module.new { def perform_gone(data, via: nil) = super }
    assert_raises(RuntimeError) { LogContent.override(Class.new { def perform_gone(data, from: nil) = nil }, keywords) }
    current = Class.new { def perform_gone(data) = data }
    LogContent.override(current, replacement)
    assert_equal 1, current.new.perform_gone(1)
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
