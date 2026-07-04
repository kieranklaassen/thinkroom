# Ruby Native shell request: session-aware link handling in Normal Mode

Ready-to-file issue for [`ruby-native/gem`](https://github.com/ruby-native/gem) (Joe Masilotti).
Copy everything below the rule into a new GitHub issue.

Origin: Thinkroom feedback ts `1783097011` — on iOS, tapping a PDF link inside a
document punted to an external browser with no session and hit a login wall
(the reporter's PDF lived behind Cora's auth). Thinkroom's app-side mitigation
landed alongside this document (same-origin page links now navigate the
webview), but the cross-origin and file-viewer parts need shell support.

---

**Title:** Normal Mode: new-window links open in a cookie-less browser context, causing login walls — need session-aware link routing

## Setup

- App: Thinkroom (Rails 8 + Inertia/React, `ruby_native` 0.10.11 + `@ruby-native/react` 0.10.11)
- Mode: Normal Mode, no tabs, iOS shell
- Our documents contain arbitrary user links. The web editor opens them with
  `window.open(url, '_blank', 'noopener,noreferrer')`.

## What our users hit

A signed-in user taps a link to a PDF inside the app. The tap leaves the
WKWebView and lands in an external browser context that has **none of their
cookies**, so instead of the file they get a login wall:

- Links back into our own app land on a **logged-out session** (the WKWebView's
  cookies don't travel).
- Links to third-party services the user is signed into **in real Safari**
  (the reported case: a PDF attachment behind another product's auth) also hit
  a login wall, which strongly suggests the context is an isolated
  `SFSafariViewController` / fresh data store rather than the Safari app —
  since iOS 11, `SFSafariViewController` shares no cookies with Safari.

We've shipped a JS-side mitigation for the first case (our editor now routes
same-origin *page* links through `window.location.assign` when
`html[data-native-app]` is present). The rest needs the shell.

## What we need

1. **Document current behavior.** What does the shell's `WKUIDelegate` do with
   new-window navigations (`window.open` / `target="_blank"`) today —
   `SFSafariViewController`, `UIApplication.shared.open`, or something else?
   The docs cover OAuth (`auth.oauth_paths`) and push-notification `url`
   handling, but not in-page link taps.

2. **Same-origin new-window requests should stay in the app.** Load them in
   the current webview (or push a second webview) sharing the same
   `WKWebsiteDataStore`, so the app session carries. Our JS mitigation only
   covers links that flow through our own click handler; any other
   `target="_blank"` same-origin link still punts out of the app.

3. **Cross-origin `http(s)` links should open where the user's sessions live —
   the real Safari app** (`UIApplication.shared.open`), not an isolated
   in-app browser context. That is the only way "the session carries" for
   third-party auth-protected links (email attachments, dashboards, etc.).
   If you want to keep `SFSafariViewController` for UX, please make it
   configurable, e.g.:

   ```yaml
   # config/ruby_native.yml
   links:
     external: safari_app   # or: safari_view_controller (current behavior?)
   ```

4. **Nice-to-have: an in-app file viewer.** When a navigation response is a
   file (PDF and friends), download it with the webview's cookie store and
   present QuickLook/PDFKit with the share sheet. In Normal Mode we cannot
   just navigate the webview to a raw file URL ourselves: a raw-file page
   renders no DOM, so none of the gem's back affordances
   (`native_back_button_tag`, navbar signals) exist and the user is stranded.
   A native viewer is the ideal end state for "tap a PDF in a document,
   read it, come back".

## Repro sketch

1. Rails app with `ruby_native` 0.10.11, Normal Mode; sign in inside the iOS app.
2. Render a page with `<a href="https://<any-site-you-are-signed-into-in-safari>/some.pdf" target="_blank">PDF</a>`
   (or `window.open` on tap).
3. Tap it: the file opens in a browser context with no cookies → login wall,
   despite an active session in Safari itself. Same story for
   same-origin links: the app session doesn't carry.

Happy to test builds — this is the main friction point for our document-heavy
app, where users constantly tap attachment links.
