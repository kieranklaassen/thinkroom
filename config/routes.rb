Rails.application.routes.draw do
  root "documents#index"

  resources :documents, only: :create

  get "d/:slug", to: "documents#show", as: :document_page
  post "d/:slug/snapshot", to: "documents#snapshot", as: :document_snapshot

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  get "up" => "rails/health#show", as: :rails_health_check

  # Redirect to localhost from 127.0.0.1 to use same IP address with Vite server
  constraints(host: "127.0.0.1") do
    get "(*path)", to: redirect { |params, req| "#{req.protocol}localhost:#{req.port}/#{params[:path]}" }
  end
end
