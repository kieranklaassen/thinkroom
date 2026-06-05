# frozen_string_literal: true

InertiaRails.configure do |config|
  # NOTE: InertiaController overrides this with a chdir-safe wrapper —
  # ViteRuby.digest chdirs and concurrent requests racing it raise.
  config.version = -> { ViteRuby.digest }
  config.encrypt_history = true
  config.always_include_errors_hash = true
  config.use_script_element_for_initial_page = true
  config.use_data_inertia_head_attribute = true
end
