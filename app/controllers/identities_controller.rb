class IdentitiesController < InertiaController
  # Set (or clear) the viewer's display name. Stored in the session — the
  # browser-stack CSRF protection means a drive-by POST can't rename you.
  # Blank means "go back to guest": delete the key entirely, never store a
  # fallback like "Anonymous" (that would break the return-to-guest flow).
  def update
    name = Document.normalize_display_name(params[:name])
    if name
      session[:display_name] = name
    else
      session.delete(:display_name)
    end

    redirect_back fallback_location: root_path, status: :see_other
  end
end
