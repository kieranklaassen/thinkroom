# Be sure to restart your server when you modify this file.

# Configure parameters to be partially matched (e.g. passw matches password) and filtered from the log file.
# Use this to limit dissemination of sensitive information.
# See the ActiveSupport::ParameterFilter documentation for supported notations and behaviors.
Rails.application.config.filter_parameters += [
  :passw, :email, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn, :cvv, :cvc,
  :name, :code, :state # chosen names and OAuth callback credentials are sensitive
]

# Columns that hold what people write and save. Active Record masks them in
# logged binds and #inspect; binds without a column name are masked too.
# Request and cable parameters go through the allowlist in log_content.rb.
content_columns = %w[
  content markdown html text title body snapshot update updates sv payload
  replaces intent quote spans paragraphs render_hints
  detail tags error error_message reviewer_runs lenses
]
Rails.application.config.filter_parameters <<
  /\A(?:(?:\w+_)?(?:#{content_columns.join("|")}))?\z/i

# Storage URLs end in the file's name, and disk keys encode it. A fragment and
# a query part without a name are text.
Rails.application.config.filter_redirect.push(
  %r{/rails/+active(?:_|%5f)storage}i, /#/, /[?&;][^=&;#]+(?:[&;#]|\z)/
)

# Rails copies the list to Active Record when that loads, which a gem does
# before this file runs.
ActiveSupport.on_load(:active_record) do
  self.filter_attributes |= Rails.application.config.filter_parameters
end
