class DocumentOgImagesController < ActionController::Base
  # This GET-only public asset must not run Inertia's XSRF after-action: those
  # cookies make otherwise public image responses private to intermediary caches.
  self.allow_forgery_protection = false

  def show
    document = Document.find_by!(slug: params[:slug])
    expires_in 1.day, public: true, stale_while_revalidate: 1.hour

    return unless stale?(
      etag: DocumentOgImage.cache_key(document),
      last_modified: document.updated_at,
      public: true
    )

    send_data DocumentOgImage.call(document),
              type: "image/png",
              disposition: "inline",
              filename: "#{document.slug}-preview.png"
  end
end
