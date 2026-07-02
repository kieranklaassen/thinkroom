module ApplicationHelper
  # The Vite dev SSR (@inertiajs/vite) emits its collected stylesheet links on
  # the dev server's OWN origin (http://localhost:3036/...). A remote reviewer
  # (Cloudflare tunnel) can never fetch that origin — and because the links
  # carry data-vite-dev-id, Vite's client registers them in its style-dedup
  # map and then skips injecting those same styles from the module graph, so
  # the editor's CSS never arrives at all: tables lose table-layout, prose
  # loses break-spaces, and the preview -> editor swap visibly jumps. Rewrite
  # the links onto the same-origin /vite-dev proxy Rails already serves —
  # same files, same dedup ids, reachable from any origin. Production heads
  # carry no dev-server links, so this is a no-op there.
  def same_origin_inertia_ssr_head
    head = inertia_ssr_head
    return head if head.blank?

    head.gsub(%r{https?://(?:localhost|127\.0\.0\.1):\d+(?=/vite-)}, "").html_safe # rubocop:disable Rails/OutputSafety
  end
end
