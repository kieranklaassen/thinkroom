# Keeps document and save content out of the log lines that
# config.filter_parameters does not reach. Each piece drops or filters the
# quoted payload of one framework line and leaves the rest of it in place.
module LogContent
  FILTERED = ActiveSupport::ParameterFilter::FILTERED

  def self.filter
    @filter ||= ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters)
  end

  # A payload that reads as usual and is filtered only when inspected.
  class Payload < Hash
    def inspect = LogContent.filter.filter(to_h).inspect
  end

  module Request
    PARAMETER_NAME = /\A[\w.-]{1,64}\z/

    # A body that is not the form it claims to be has no parameter names worth
    # logging.
    def filtered_parameters
      @filtered_parameters ||= if request_parameters.keys.all?(PARAMETER_NAME)
        super
      else
        parameter_filter.filter(query_parameters.merge(path_parameters)).merge(FILTERED => FILTERED)
      end
    rescue ActionDispatch::Http::Parameters::ParseError
      super
    end

    private

    def log_parse_error_once
      @parse_error_logged ||= begin
        logger&.debug("Error occurred while parsing request parameters.")
        true
      end
    end
  end

  # A request that cannot be parsed is logged by error class and backtrace.
  module BadRequests
    QUOTING = [ ActionDispatch::Http::Parameters::ParseError, ActionDispatch::ParamError, JSON::ParserError ].freeze

    private

    def compose_exception_message(wrapper)
      exceptions = [ wrapper, *wrapper.wrapped_causes ].map(&:exception)
      return super unless exceptions.any? { |error| error.instance_of?(ActionController::BadRequest) || QUOTING.any? { |type| type === error } }

      [ "  ", "#{exceptions.map(&:class).join(" caused by ")}:", "  ", *wrapper.exception_trace ]
    end
  end

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
      logger.error "Could not execute command from (#{describe(data)}) [#{e.class}]: #{e.backtrace.first(5).join(" | ")}"
    end

    def remove(data)
      logger.info "Unsubscribing from channel: #{describe(data)}"
      remove_subscription find(data)
    end

    private

    def describe(data)
      return data.class.name unless data.is_a?(Hash)

      identifier = ActiveSupport::JSON.decode(data["identifier"].to_s)
      identifier = FILTERED unless identifier.is_a?(Hash)
      LogContent.filter.filter("command" => data["command"], "identifier" => identifier).inspect
    rescue JSON::ParserError
      FILTERED
    end
  end

  module CableMessages
    def broadcast(channel, payload)
      ActiveRecord::Base.logger ? ActiveRecord::Base.logger.silence { super } : super
    end
  end

  module ServerRendering
    private

    def handle_error(error)
      return super if @configuration.ssr_raise_on_error

      super(error.class.new("message withheld"))
    end
  end
end

ActionDispatch::Request.prepend LogContent::Request
ActionDispatch::DebugExceptions.prepend LogContent::BadRequests
ActionCable::Connection::Subscriptions.prepend LogContent::CableSubscriptions
InertiaRails::SSRRenderer.prepend LogContent::ServerRendering
Rails.application.config.to_prepare { SolidCable::Message.singleton_class.prepend LogContent::CableMessages }
