class AiSuggestionsController < InertiaController
  def create
    document = Document.find_by!(slug: params[:slug])

    GeminiSuggester.call(
      document:,
      instruction: params[:instruction].presence,
      context: params[:context].presence,
      anchor_text: params[:anchor_text].presence,
      replaces: params[:replaces].presence
    )

    head :created
  end
end
