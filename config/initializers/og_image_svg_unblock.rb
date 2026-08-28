# CVE-2026-66066 (activestorage 8.1.3.1) makes ActiveStorage call
# Vips.block_untrusted(true) at boot, which disables libvips's unfuzzed SVG
# loader — the right default, since ActiveStorage may run it against
# arbitrary user-uploaded files.
#
# SiteOgImage and DocumentOgImage never touch user-uploaded SVG: they
# rasterize SVG markup this app generates from a fixed template, with all
# variable text run through ERB::Util.html_escape before interpolation (see
# app/services/document_og_image.rb#escape), so there is no way for
# attacker-controlled bytes to reach the parser as SVG structure. Uploaded
# images (ImageUploadPolicy) are restricted to PNG/JPEG/WebP and never use
# svgload. Re-enabling just the SVG loader keeps every other untrusted
# loader (PDF, GIF, HEIF, ImageMagick, ...) blocked.
# This unblock is process-global and permanent (not scoped to just these two
# call sites) — toggling it per-call would open a TOCTOU window under Puma's
# multi-threaded server, which is worse. The trade-off: any future code path
# that feeds untrusted bytes to libvips inherits SVG re-enablement too, so
# keep svgload_buffer's callers limited to app-generated markup like this.
Rails.application.config.after_initialize do
  require "active_storage/vips"
  Vips.block("VipsForeignLoadSvg", false) if ActiveStorage::VIPS_AVAILABLE
end
