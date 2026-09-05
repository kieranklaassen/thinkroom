# Guided review port evidence

Captured on the local development app using an isolated document, not production data.

- [Pending, keyboard focus](desktop-pending.png): navigation selects the passage without reviewing it.
- [Reviewed](desktop-reviewed.png): endorsement remains a separate decision.
- [Endorsed](desktop-endorsed.png): Done closes the guidance.
- [Narrow desktop / 200% zoom-equivalent CSS viewport](zoom-equivalent.png): actions remain reachable at 800 × 600 CSS pixels. This is viewport emulation, not a physical browser zoom test.
- [Phone, Whitey theme](phone-whitey.png): shared compact navigation and touch-sized actions.
- [Phone, all reviewed](phone-all-reviewed.png): zero pending text gives a non-mutating completion message.

The existing browser and native-shell checks exercise two-client state propagation, exact-interval review after adjacent ranges merge, reload/undo, remote insertion/deletion/replacement, mode restrictions, native safe-area emulation, and keyboard focus. Physical iOS/WKWebView testing remains outside this local evidence.
