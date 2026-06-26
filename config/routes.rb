Rails.application.routes.draw do
  root "documents#index"

  get "manifest" => "pwa#manifest", as: :pwa_manifest

  resources :documents, only: :create

  post "identity", to: "identities#update", as: :identity

  get "login", to: "sessions#new", as: :login
  post "login", to: "sessions#create"
  delete "logout", to: "sessions#destroy", as: :logout
  get "signup", to: "registrations#new", as: :signup
  post "signup", to: "registrations#create"
  match "/auth/:provider/callback", to: "oauth_callbacks#create", via: %i[get post]
  get "/auth/failure", to: "oauth_callbacks#failure"

  get "d/:slug", to: "documents#show", as: :document_page
  post "d/:slug/claim", to: "documents#claim", as: :claim_document
  patch "d/:slug/editing_lock", to: "documents#update_editing_lock", as: :document_editing_lock
  delete "d/:slug", to: "documents#destroy", as: :destroy_document
  post "d/:slug/snapshot", to: "documents#snapshot", as: :document_snapshot
  post "d/:slug/sync_update", to: "documents#sync_update", as: :document_sync_update
  post "d/:slug/suggestions", to: "suggestions#create", as: :document_suggestions
  patch "d/:slug/suggestions/accept_all", to: "suggestions#accept_all", as: :accept_all_document_suggestions

  patch "suggestions/:id/accept", to: "suggestions#accept", as: :accept_suggestion
  patch "suggestions/:id/reopen", to: "suggestions#reopen", as: :reopen_suggestion
  patch "suggestions/:id/reject", to: "suggestions#reject", as: :reject_suggestion

  post "d/:slug/comments", to: "comments#create", as: :document_comments
  patch "comments/:id/resolve", to: "comments#resolve", as: :resolve_comment

  post "/rails/active_storage/direct_uploads", to: "api/direct_uploads#create"

  namespace :api do
    post "uploads", to: "uploads#create"
    post "docs", to: "docs#create"
    get "docs/:slug", to: "docs#show", as: :doc
    patch "docs/:slug", to: "docs#update"
    post "docs/:slug/suggestions", to: "suggestions#create", as: :doc_suggestions
    post "docs/:slug/comments", to: "comments#create", as: :doc_comments
    post "docs/:slug/comments/:id/resolve", to: "comments#resolve", as: :doc_resolve_comment
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
