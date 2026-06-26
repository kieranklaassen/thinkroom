module FeedbackOutputSanitizer
  BUNDLE_URL = %r{https?://[^\s"']+/feedback_runs/bundle/[^\s"']+}
  RESULT_LIMIT = 64.kilobytes
  ERROR_LIMIT = 500

  module_function

  def result(value)
    return if value.nil?

    sanitize(value, limit: RESULT_LIMIT)
  end

  def error(value)
    sanitize(value, limit: ERROR_LIMIT, fallback: "Cursor returned an unreadable error.")
  end

  def sanitize(value, limit:, fallback: nil)
    text = value.is_a?(String) ? value : JSON.generate(value)
    text = text.gsub(BUNDLE_URL, "[private bundle URL]")
    api_key = ENV["CURSOR_API_KEY"].presence
    text = text.gsub(api_key, "[redacted credential]") if api_key
    text.truncate(limit)
  rescue JSON::GeneratorError
    fallback
  end
end
