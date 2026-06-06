# Problem Analysis — Riffrec session 2026-06-05 18:54 (pruf.kieranklaassen.com)

Session: 71s voice + screen recording on `https://pruf.kieranklaassen.com/d/VCDx7RNVtk`. Transcript confirmed against frames; all four findings below are verbal, explicit, and tied to visible UI. Frames live in `docs/brainstorms/riffrec-feedback/2026-06-05-1854/frames/` (local-only).

## 1. Visual/UI Problems

1. **Doc header right side is overcrowded** — 8 elements (identity chip, provenance chip, presence bar, Panel toggle, Focus toggle, ownership chip, feedback button, Share button) sit in one undifferentiated row at equal visual weight. Location: doc page header, `app/frontend/pages/documents/show.tsx` right header group. Frames: M3 (51.1s), M5 (58.8s). Transcript: *"this menu here is a little bit messy… just clean it up a little bit… panel, focus, claim, yeah… it's a little bit weird."*
2. **Share is visually buried** despite being, per the user, *"the most important thing."* Same location/frames as above.

## 2. Functional Problems

1. **No claim affordance on home-page Recent rows.** The Recent list renders title-only links; ownership/claimability metadata is not shipped to the index page at all (`documents#index` props omit it). Frame: M1 (6.1s, home page). Transcript: *"if I see these recents, maybe I wanna see an icon here to claim them as well."* Classification: missing surface (High confidence).

## 3. Requirements

1. Recent docs on the home page need a per-row claim affordance for claimable docs.
2. The doc-page claim CTA needs to be clearly visible — the user suggested a banner ("claim this one to your account") rather than the current small header chip.
3. The doc header chrome needs consolidation: secondary controls (Panel, Focus, and similar) grouped into a single menu; Share promoted to the primary action.
4. A Google Docs-style mode switcher: the user wants to switch between **Edit**, **Suggest**, and **Comment** modes. Transcript: *"I want this mode similar to Google Docs where you go edit mode, suggest mode, or comment mode."* No mode infrastructure exists today (suggestions are margin cards proposed by agents; comments are a side panel) — this is a new capability, not a fix.

## 4. Usability/UX Problems

1. **Claim discoverability is low** on the doc page: the Claim button renders in the same chrome-toggle style and size as Panel/Focus (frame M3, M5), so a critical ownership action reads as a minor view toggle. Transcript: *"it has a claim button, but maybe make it a little bit more clear, like a banner, like claim this one to your account."*
2. **Header scanability**: with everything at equal weight, the user could not parse the header quickly ("panel, focus, claim… it's a little bit weird") — grouping and hierarchy are missing rather than any control being broken. M6 (71.2s) is the Stop-and-save click ending the recording, not product friction.
