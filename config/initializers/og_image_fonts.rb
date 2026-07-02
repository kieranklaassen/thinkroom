# The document OG image (DocumentOgImage) rasterizes an SVG through
# ruby-vips/librsvg, which resolves fonts through the system fontconfig. The
# design depends on two custom families — Newsreader (serif) and Instrument
# Sans — that are not installed in dev, CI, or the production image. Rather than
# patch every environment's font path, we ship the OFL TTFs in vendor/fonts and
# point fontconfig at them here by generating a config that includes the system
# defaults plus our directory, then exporting FONTCONFIG_FILE before libvips
# first touches fontconfig (which happens lazily on the first render, always
# after boot).
Rails.application.config.after_initialize do
  fonts_dir = Rails.root.join("vendor/fonts")

  if fonts_dir.directory?
    begin
      cache_dir = Rails.root.join("tmp/cache/fontconfig")
      FileUtils.mkdir_p(cache_dir)

      config_file = cache_dir.join("og_image_fonts.conf")
      config_file.write(<<~XML)
        <?xml version="1.0"?>
        <!DOCTYPE fontconfig SYSTEM "fonts.dtd">
        <fontconfig>
          <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
          <dir>#{fonts_dir}</dir>
          <cachedir>#{cache_dir}</cachedir>
        </fontconfig>
      XML

      # Only override when nothing else has claimed FONTCONFIG_FILE, so a host
      # that already provides a richer config wins. Our generated file still
      # <include>s the system config, so setting it never removes system fonts.
      ENV["FONTCONFIG_FILE"] ||= config_file.to_s
    rescue SystemCallError => e
      # A read-only tmp or similar must not take the whole app down — the OG
      # renderer just falls back to a generic serif/sans instead.
      Rails.logger.warn("[og_image_fonts] skipped font registration: #{e.message}")
    end
  end
end
