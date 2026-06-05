Rails.application.routes.draw do
  root "documents#index"

  resources :documents, only: :create

  get "d/:slug", to: "documents#show", as: :document_page
  post "d/:slug/snapshot", to: "documents#snapshot", as: :document_snapshot
  post "d/:slug/ai_suggestions", to: "ai_suggestions#create", as: :document_ai_suggestions

  patch "suggestions/:id/accept", to: "suggestions#accept", as: :accept_suggestion
  patch "suggestions/:id/reject", to: "suggestions#reject", as: :reject_suggestion

  post "d/:slug/comments", to: "comments#create", as: :document_comments
  patch "comments/:id/resolve", to: "comments#resolve", as: :resolve_comment

  namespace :api do
    post "docs", to: "docs#create"
    get "docs/:slug", to: "docs#show", as: :doc
    post "docs/:slug/suggestions", to: "suggestions#create", as: :doc_suggestions
    post "docs/:slug/comments", to: "comments#create", as: :doc_comments
    post "docs/:slug/presence", to: "presences#create", as: :doc_presence
    get "docs/:slug/events/pending", to: "events#pending", as: :doc_pending_events
    post "docs/:slug/events/ack", to: "events#ack", as: :doc_ack_events
  end

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  get "up" => "rails/health#show", as: :rails_health_check

  # Redirect to localhost from 127.0.0.1 to use same IP address with Vite server
  constraints(host: "127.0.0.1") do
    get "(*path)", to: redirect { |params, req| "#{req.protocol}localhost:#{req.port}/#{params[:path]}" }
  end
end
