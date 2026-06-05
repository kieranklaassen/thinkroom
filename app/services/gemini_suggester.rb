require "net/http"

# The AI path: generates a suggestion passage with Gemini when GEMINI_API_KEY
# is present, falling back to canned passages so the suggestion machinery works
# offline. Returns the created Suggestion (already broadcast).
class GeminiSuggester
  MODEL = "gemini-2.0-flash"
  ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/#{MODEL}:generateContent"

  CANNED = [
    "Consider opening with the reader's problem instead of the product: name the friction of not knowing who wrote what, then introduce provenance as the answer. A single concrete scenario — two collaborators and an AI editing the same paragraph — will carry more weight than any feature list.",
    "This section would benefit from a worked example. Show a sentence before and after AI revision, with the provenance marks visible, so readers can see exactly how attribution travels with the text rather than taking it on faith.",
    "A short closing paragraph could tie the threads together: live collaboration gives speed, provenance gives trust, and the review states give editors a deliberate path from machine draft to human-endorsed prose."
  ].freeze

  def self.call(document:, instruction: nil, context: nil, author_name: "Gemini", author_kind: "ai", anchor_text: nil, replaces: nil)
    body = generate(document:, instruction:, context:) || CANNED.sample

    Suggestion.propose!(
      document:,
      author_name:,
      author_kind:,
      intent: instruction.presence || (replaces.present? ? "Rewrite selection" : "Add a passage"),
      body: body.strip,
      anchor_text:,
      replaces:
    )
  end

  def self.generate(document:, instruction:, context:)
    api_key = ENV["GEMINI_API_KEY"]
    return nil if api_key.blank?

    prompt = <<~PROMPT
      You are a careful writing collaborator inside a provenance-tracking editor.
      The document (markdown):

      #{document.plain_markdown.presence || document.seed_markdown.to_s.truncate(4000)}

      #{context.present? ? "The human selected this passage:\n\n#{context}\n" : ""}
      Instruction: #{instruction.presence || "Suggest a passage that improves or extends the document."}

      Respond with ONLY the suggested markdown passage — no preamble, no quotes,
      no explanation. Keep it concise (one to three short paragraphs).
    PROMPT

    uri = URI("#{ENDPOINT}?key=#{api_key}")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.open_timeout = 5
    http.read_timeout = 15

    response = http.post(
      uri.request_uri,
      { contents: [ { parts: [ { text: prompt } ] } ] }.to_json,
      { "Content-Type" => "application/json" }
    )
    return nil unless response.is_a?(Net::HTTPSuccess)

    JSON.parse(response.body).dig("candidates", 0, "content", "parts", 0, "text")
  rescue StandardError => e
    Rails.logger.warn("GeminiSuggester fell back to canned response: #{e.class}: #{e.message}")
    nil
  end
end
