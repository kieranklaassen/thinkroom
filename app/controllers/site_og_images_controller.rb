class SiteOgImagesController < ActionController::Base
  # This GET-only public asset must not run Inertia's XSRF after-action: those
  # cookies make otherwise public image responses private to intermediary caches.
  self.allow_forgery_protection = false

  def show
    expires_in 1.day, public: true, stale_while_revalidate: 1.hour

    return unless stale?(etag: SiteOgImage.cache_key, public: true)

    send_data SiteOgImage.call,
              type: "image/png",
              disposition: "inline",
              filename: "thinkroom-preview.png"
  end
end
