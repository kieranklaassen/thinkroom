# Keeps document and save content out of the log. Requests and cable frames are
# logged through an allowlist (READABLE); the framework lines that have no
# setting are overridden below, each with a boot-time check that the method it
# replaces still exists and takes the same kinds of parameters.
module LogContent
  FILTERED = ActiveSupport::ParameterFilter::FILTERED

  flag = /\A(?:true|false|on|off|1|0)\z/
  number = /\A\d{1,16}\z/
  MAX_NUMBER = 2**53
  MAX_VALUES = 20
  uuid = /\A\h{8}(?:-\h{4}){3}-\h{12}\z/

  # The only parameters and frame fields shown in the log, each with the shape a
  # String value must have. Booleans, nil, and a single Integer up to MAX_NUMBER
  # pass as they are; an Array passes when it is short and all its values are
  # such Strings. Everything else, names included, is logged as one "[FILTERED]"
  # entry.
  READABLE = {
    "id" => number, "index" => number, "seq" => number, "generation" => number,
    "client_id" => number, "last_event_id" => number,
    "cid" => uuid, "session_id" => uuid,
    "slug" => /\A(?:demo|[1-9A-HJ-NP-Za-km-z]{10})\z/,
    "archived" => flag, "locked" => flag, "remember_me" => flag, "stale" => flag, "seed" => flag, "seed_pending" => flag,
    "mode" => /\A(?:edit|suggest|comment|read)\z/,
    "access" => /\A(?:edit|comment|view)\z/,
    "format" => /\A(?:json|html|txt|markdown|png)\z/,
    "content_format" => /\A(?:markdown|html)\z/,
    "status" => /\A(?:active|done)\z/,
    "provider" => /\Agoogle_oauth2\z/,
    "reviewers" => %r{\Acompound-writing/cw-[a-z]{1,20}(?:-[a-z]{1,20}){0,3}\z},
    "_method" => /\A(?:patch|put|delete)\z/,
    "channel" => /\A(?:SyncChannel|DocumentMetaChannel)\z/,
    "type" => /\A(?:sync|sync-reply|update|awareness|awareness-leave|ack|nack|write-denied|seed-decline|seed-request)\z/,
    "event" => /\A(?:version|title|comments|suggestions|activities|presences|ownership|editing_lock|highlight_names|content_reset|document_deleted|writing_pass)\z/,
    "reason" => /\A(?:retryable|invalid|stale)\z/
  }.freeze

  # Errors whose message names code rather than a value.
  DESCRIPTIVE = [ NameError, NoMethodError, ActionController::ParameterMissing ].freeze

  # A feedback bundle's path, as written: its last part, up to a file format.
  bundle = "/feedback_runs/bundle/".each_char.map do |char|
    "(?:#{char}|%#{char.unpack1("H*")})#{"++" if char == "/"}"
  end
  BUNDLE = /(?<prefix>#{bundle.join})[^?]+?(?<format>\.(?:zip|json|html|txt))?(?=\?|\z)/i

  class << self
    # The path or URL, also inside a message, without a bundle's token.
    def hide_bundle(text)
      text.b.sub(BUNDLE) { "#{$~[:prefix]}#{FILTERED}#{$~[:format]}" }.force_encoding(text.encoding)
    end

    def redact(params)
      params.each_with_object(params.class.new) do |(name, value), shown|
        readable?(name, value) ? shown[name] = value : shown[FILTERED] = FILTERED
      end
    end

    # One line for an error: class, cause classes, and the first frames.
    def describe(error)
      causes = []
      cause = error
      causes << title(cause) while (cause = cause.cause)
      [ title(error), *causes.map { |text| "caused by #{text}" }, *error.backtrace&.first(5) ].join(" | ")
    end

    def title(error, name = error.class.name)
      descriptive?(error) ? "#{name} (#{hide_bundle(error.message.to_s)})" : name
    end

    def describe_command(data)
      return data.class.name unless data.is_a?(Hash)

      identifier = ActiveSupport::JSON.decode(data["identifier"].to_s)
      "#{data["command"]} #{identifier.is_a?(Hash) ? redact(identifier) : FILTERED}"
    rescue JSON::ParserError
      FILTERED
    end

    # The same error, for a log line that would quote its message.
    def without_message(error, message = "message not logged")
      return error if error.nil? || descriptive?(error)

      copy = begin
        error.clone(freeze: false)
      rescue StandardError
        message = "#{error.class.name}: #{message}"
        RuntimeError.new(message)
      end
      copy.define_singleton_method(:message) { |*| message }
      copy.set_backtrace(error.backtrace || [])
      copy
    end

    def override(target, replacement)
      (replacement.instance_methods(false) + replacement.private_instance_methods(false)).each do |name|
        original = target.instance_method(name) if target.method_defined?(name) || target.private_method_defined?(name)
        next if original && signature(original) == signature(replacement.instance_method(name))

        found = original ? "now takes #{original.parameters} (#{original.source_location&.join(":")})" : "no longer exists"
        raise "log_content: #{target}##{name} #{found}. Its override #{replacement}##{name} takes " \
              "#{replacement.instance_method(name).parameters}. Re-verify it in " \
              "config/initializers/log_content.rb against the installed gem."
      end
      target.prepend(replacement)
    end

    private

    # Development logs keep error messages.
    def descriptive?(error)
      Rails.env.development? || DESCRIPTIVE.any? { |type| error.instance_of?(type) }
    end

    # Parameter kinds in order, and keyword names.
    def signature(method)
      method.parameters.map { |kind, name| kind.start_with?("key") ? [ kind, name ] : kind }
    end

    def readable?(name, value)
      shape = READABLE[name.to_s] or return false

      case value
      when String then value.valid_encoding? && value.match?(shape)
      when Integer then value.abs <= MAX_NUMBER
      when Array then value.size <= MAX_VALUES && value.all? { |item| item.is_a?(String) && readable?(name, item) }
      when true, false, nil then true
      end
    end
  end

  class Filter < ActiveSupport::ParameterFilter
    def filter(params) = LogContent.redact(params)
  end

  # A hash that reads as usual and is redacted only when inspected.
  class Payload < Hash
    def inspect = LogContent.redact(to_h).inspect

    # Yields the message to log and send. Only a hash has fields to show; any
    # other message is sent as it is, without its debug line.
    def self.with(message)
      return yield(self[message]) if message.is_a?(Hash)

      ActionCable.server.logger.silence { yield message }
    end
  end

  module Request
    STORAGE = %r{\A/+rails/+active_storage/+(?:(?<kind>blobs|representations|disk)/+)?(?:(?<how>redirect|proxy)/+)?}

    def parameter_filter = @parameter_filter ||= Filter.new

    def filtered_parameters
      @filtered_parameters ||= parameter_filter.filter(parameters.except(:controller, :action))
                                               .merge(path_parameters.slice(:controller, :action))
    rescue ActionDispatch::Http::Parameters::ParseError
      @filtered_parameters = {}
    end

    # Storage paths end in the file's name, and disk keys encode it.
    def filtered_path
      @filtered_path ||= begin
        storage = STORAGE.match(CGI.unescapeURIComponent(path.b).b)
        shown = storage ? [ "/rails/active_storage", storage[:kind], storage[:how], FILTERED ].compact.join("/") : LogContent.hide_bundle(path)
        query_string.empty? ? shown : "#{shown}?#{filtered_query_string}"
      end
    end

    private

    # Parts without a name are text.
    def filtered_query_string
      super.gsub(/(?<=\A|[&;])[^=&;]+(?=[&;]|\z)/, FILTERED)
    end

    def log_parse_error_once
      @parse_error_logged ||= begin
        logger&.debug("Error occurred while parsing request parameters.")
        true
      end
    end
  end

  module RedirectLocation
    def filtered_location = LogContent.hide_bundle(super)
  end

  # Unhandled errors are logged by class, causes, and backtrace.
  module Exceptions
    private

    # As in Action Dispatch, with lines of our own. The error page composes its
    # copy text with the method these lines replace here.
    def log_error(request, wrapper)
      logger = logger(request)
      return unless logger
      return if !log_rescued_responses?(request) && wrapper.rescue_response?

      lines = [ wrapper, *wrapper.wrapped_causes ].flat_map.with_index do |current, index|
        [ "  ", "#{"Caused by: " if index.positive?}#{LogContent.title(current.exception, current.exception_class_name)}:",
          *current.annotated_source_code, "  ", *current.exception_trace ]
      end
      log_array(logger, lines, request)
    end
  end

  # Redirects in the routes are logged without config.filter_redirect.
  module RouteRedirects
    def redirect(event)
      location = event.payload[:location].to_s
      hidden = location.match?(Regexp.union(Rails.application.config.filter_redirect))
      shown = hidden ? FILTERED : LogContent.hide_bundle(location)
      super(event.dup.tap { |copy| copy.payload = event.payload.merge(location: shown) })
    end
  end

  module RescuedExceptions
    def rescue_from_callback(event)
      super(event.dup.tap { |copy| copy.payload = event.payload.merge(exception: LogContent.without_message(event.payload[:exception])) })
    end
  end

  module JobExceptions
    %i[enqueue enqueue_at perform enqueue_retry retry_stopped discard step].each do |name|
      define_method(name) do |event|
        errors = event.payload.slice(:exception_object, :error).transform_values { |error| LogContent.without_message(error) }
        refused = event.payload[:job]&.enqueue_error if name.in?(%i[enqueue enqueue_at])
        errors[:exception_object] ||= LogContent.without_message(refused) if refused
        super(event.dup.tap { |copy| copy.payload = event.payload.merge(errors) })
      end
    end
  end

  module CableChannel
    private

    def transmit(data, via: nil) = Payload.with(data) { |shown| super(shown, via:) }

    def action_signature(action, data)
      super(self.class.action_methods.include?(action.to_s) ? action : FILTERED, data)
    end

    def parameter_filter = @parameter_filter ||= Filter.new
  end

  module CableBroadcasts
    def broadcast_to(broadcastables, message) = Payload.with(message) { |shown| super(broadcastables, shown) }
  end

  module CableConnection
    # As in Action Cable, without quoting the frame.
    def dispatch_websocket_message(websocket_message)
      return handle_channel_command(decode(websocket_message)) if websocket.alive?

      logger.error "Ignoring message processed after the WebSocket was closed (#{websocket_message.bytesize} bytes)"
    end

    private

    def decode(websocket_message)
      super
    rescue JSON::ParserError
      raise JSON::ParserError, "message is not valid JSON", cause: nil
    end
  end

  # As in Action Cable, without quoting the command.
  module CableSubscriptions
    def execute_command(data)
      case data["command"]
      when "subscribe"   then add data
      when "unsubscribe" then remove data
      when "message"     then perform_action data
      else
        logger.error "Received unrecognized command"
      end
    rescue Exception => e
      @connection.rescue_with_handler(e)
      logger.error "Could not execute command from (#{LogContent.describe_command(data)}) [#{LogContent.describe(e)}]"
    end

    def add(data)
      channel = ActiveSupport::JSON.decode(data["identifier"]).with_indifferent_access[:channel].safe_constantize
      return super if channel && ActionCable::Channel::Base > channel

      logger.error "Subscription class not found"
    end

    def remove(data)
      logger.info "Unsubscribing from channel: #{LogContent.describe_command(data)}"
      remove_subscription find(data)
    end
  end

  module CableMessages
    def broadcast(channel, payload)
      ActiveRecord::Base.logger ? ActiveRecord::Base.logger.silence { super } : super
    end
  end

  module StorageUrls
    def service_url(event)
      debug event, "Generated URL for file at key: #{key_in(event)}"
    end
  end

  module ServerRendering
    private

    def handle_error(error)
      return super if @configuration.ssr_raise_on_error

      # The renderer wraps other errors, such as timeouts, before this.
      raised = $! unless $!.is_a?(InertiaRails::SSRError)
      super(LogContent.without_message(error, (raised&.class || error.type || "render error").to_s))
    end
  end

  override ActionDispatch::Request, Request
  override ActionDispatch::Response, RedirectLocation
  override ActionDispatch::DebugExceptions, Exceptions
  override ActionDispatch::LogSubscriber, RouteRedirects
  override ActionController::LogSubscriber, RescuedExceptions
  override ActionCable::Connection::Subscriptions, CableSubscriptions
  override ActiveStorage::LogSubscriber, StorageUrls
  override InertiaRails::SSRRenderer, ServerRendering
  ActiveSupport.on_load(:active_job) { LogContent.override ActiveJob::LogSubscriber, LogContent::JobExceptions }
  ActiveSupport.on_load(:action_cable_connection) { LogContent.override self, LogContent::CableConnection }
  ActiveSupport.on_load(:action_cable_channel) do
    LogContent.override self, LogContent::CableChannel
    LogContent.override singleton_class, LogContent::CableBroadcasts
  end
  Rails.application.config.to_prepare { LogContent.override SolidCable::Message.singleton_class, LogContent::CableMessages }
end
