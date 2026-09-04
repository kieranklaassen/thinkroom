# Theme picker and appearance evidence — #218

Captured from the isolated Thinkroom development app on 2026-09-04. These are actual browser screenshots, not mockups. The fixture contains human and AI provenance, review states, a highlight, a comment, a suggestion, code, and a sketch surface.

| Surface | Warm paper | Whitey |
| --- | --- | --- |
| Desktop, 1600px | [Document](proof-desktop.png) · [Picker](proof-picker.png) | [Document](whitey-desktop.png) · [Picker](whitey-picker.png) |
| Tablet, 900px | [Document](proof-tablet.png) | [Document](whitey-tablet.png) |
| Phone, 390px | [Document](proof-phone.png) | [Document](whitey-phone.png) · [Options](phone-options.png) |
| JavaScript disabled, 1600px | [First paint](proof-cold.png) | [First paint](whitey-cold.png) |

The same local demo before and after Whitey's typography change: [before](whitey-before.png) · [after](whitey-after.png). The original design references are [next door](../pruf-port-2026-09-04/README.md).

## Observed checks

- Both themes had zero horizontal page overflow at all three widths.
- JavaScript-disabled pages had the saved root theme and matching document font. The static and live heading geometry agree; existing annotation cards still measure their positions after the editor starts.
- Reduced-motion captures used the existing 0.01ms transition/animation override.
- Desktop radio navigation, Escape/focus return, Space activation, compact touch selection, and shared picker state passed browser checks. The native-shell contract was tested in Chromium with the Ruby Native user-agent marker, not on an iOS device.
- The exact theme shortcut is **Command/Control + Shift + Period**. It preserves the live selection and does not also trigger suggestion focus. Repeat, composition, extra modifiers and text inputs are ignored.
- Mid-document switching retains the visible block's position. At the document end the browser can clamp scrolling when the new theme is shorter; no artificial trailing space is added.
- Explicit prose and rich-content widths survive theme changes; unset prose widths follow the theme default.

Tests live in the existing `script/browser_check.mjs`, `script/native_shell_check.mjs`, `script/rich_block_width_check.mjs`, and `test/integration/document_ui_preferences_test.rb`.
