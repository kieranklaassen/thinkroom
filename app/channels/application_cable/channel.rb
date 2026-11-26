module ApplicationCable
  class Channel < ActionCable::Channel::Base
    # Log lines about broadcasts and transmissions show the filtered payload.
    def self.broadcast_to(model, message) = super(model, LogContent::Payload[message])

    private

    def transmit(data, via: nil) = super(LogContent::Payload[data], via:)
  end
end
