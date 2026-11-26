# Be sure to restart your server when you modify this file.

# Configure parameters to be partially matched (e.g. passw matches password) and filtered from the log file.
# Use this to limit dissemination of sensitive information.
# See the ActiveSupport::ParameterFilter documentation for supported notations and behaviors.
Rails.application.config.filter_parameters += [
  :passw, :email, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn, :cvv, :cvc,
  :name, :code, :state # chosen names and OAuth callback credentials are sensitive
]

# What people write and save: request and cable fields, and the columns that
# store them (Active Record filters logged binds and #inspect by this list).
# A name matches whole, or after a prefix ("anchor_text", "seed_content"), so
# content_format, updated_at, or metadata stay readable. Query strings and
# redirect locations are filtered before decoding, hence the bracket forms.
content_fields = %w[
  content markdown html text title body snapshot sketch
  update updates sv payload data file archive _json
  replaces with intent quote spans paragraphs render_hints
  location detail tags error_message reviewer_runs
]
Rails.application.config.filter_parameters <<
  /(?:\A|\[|%5B)(?:\w+_)?(?:#{content_fields.join("|")})(?:\z|\[|\]|%5B|%5D)/i

# A long value is text whatever its field is called.
Rails.application.config.filter_parameters << lambda do |_name, value|
  value.replace("[FILTERED]") if value.is_a?(String) && value.bytesize > 255
end

# Storage URLs end in the file's name, and disk keys encode it.
Rails.application.config.filter_redirect << "/rails/active_storage/"

# Rails copies the list to Active Record when that loads, which a gem does
# before this file runs.
ActiveSupport.on_load(:active_record) do
  self.filter_attributes |= Rails.application.config.filter_parameters
end
