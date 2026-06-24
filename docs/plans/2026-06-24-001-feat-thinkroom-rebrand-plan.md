---
title: Rename Pruf to Thinkroom with dual-domain compatibility
type: feat
date: 2026-06-24
origin: STRATEGY.md
---

# Rename Pruf to Thinkroom with dual-domain compatibility

## Summary

Rename the public product to Thinkroom, adopt the approved positioning from `STRATEGY.md`, and serve the app from `thinkroom.kieranklaassen.com` while keeping every existing `pruf.kieranklaassen.com` link operational.

## Problem frame

The product strategy and working name are now Thinkroom, but the application, agent guide, install metadata, sharing copy, documentation, and production hostname still present Pruf. A naive global rename would either leave visible inconsistencies or break stable data, deployment, and browser-state identifiers that existing documents depend on.

## Requirements

- R1. Every human-facing product reference uses Thinkroom, including the home wordmark, document chrome, application icons, page metadata, PWA metadata, feedback consent, share copy, theme label, and user-facing errors.
- R2. The home page uses the approved one-liner “Where deeper thinking compounds.” and credits Thinkroom as being from the creator of Compound Engineering.
- R3. Agent-facing discovery and API guidance names Thinkroom while preserving all existing routes, request formats, headers, content semantics, and response contracts.
- R4. `thinkroom.kieranklaassen.com` becomes the primary production hostname and `pruf.kieranklaassen.com` remains a fully functional alias without forced redirects.
- R5. Existing documents, persistent storage, deployment history, cookies, browser preferences, and trusted editor metadata continue to work without migration or reset.
- R6. The public README carries Thinkroom’s strategy, describes it as an open-source agent-native human judgment layer, and explicitly credits inspiration from Proof by Dan Shipper.
- R7. Automated tests cover visible branding, agent guidance, legacy-host compatibility, the new hostname, and the absence of stale public Pruf copy.
- R8. DNS, SSH, registry, and deployment credentials remain machine-local or in the existing secret-management path; no keys or credential values are added to source control.

## Key technical decisions

- KTD1. **Rename the presentation contract, preserve stable internals:** User-visible strings and semantic internal names move to Thinkroom, while the repository name, Rails routes, API paths, database schema, Kamal service/image/volume names, theme cookie value, and `pruf:*` browser-storage keys remain unchanged for compatibility.
- KTD2. **Serve both domains as peers:** Configure Kamal’s proxy `hosts` list with Thinkroom first and Pruf second, allowing either origin to generate valid share URLs and WebSocket connections without redirecting legacy links.
- KTD3. **Use one production data plane:** Both hostnames terminate at the existing Hetzner app and persistent volume; no data copy, forked environment, or parallel service is introduced.
- KTD4. **Treat DNS and TLS as release gates:** The Thinkroom A record must resolve to the current Hetzner address before a dual-host Kamal deployment requests certificates for both names.
- KTD5. **Make strategy the copy source:** The home page and README use `STRATEGY.md` language rather than inventing a second positioning narrative during implementation.

## Scope boundaries

### Included

- Public UI, document chrome, application/favicons, share flows, agent-facing help, PWA metadata, feedback text, theme display names, README, and relevant code comments or semantic constants.
- Dual-host proxy configuration, DNS setup when credentials are available, TLS issuance, deployment, and production verification on both hostnames.
- The uncommitted `STRATEGY.md` created in the preceding strategy workflow.

### Outside this change

- Renaming the GitHub repository, local checkout directory, container service, registry image, persistent volume, database entities, URL routes, or API endpoints.
- Redirecting the legacy Pruf domain or invalidating existing share URLs.
- Designing a broader visual system, illustration set, or brand campaign beyond a focused Thinkroom icon, wordmark, and `T.` monogram.

## Acceptance examples

- AE1. Given an existing Pruf share URL, when a visitor opens it after release, then the same document loads with Thinkroom branding and no redirect or data loss.
- AE2. Given the same document slug on the Thinkroom hostname, when a visitor opens it, then it loads from the same persistent document state with working collaboration and API discovery.
- AE3. Given a visitor on the Thinkroom hostname, when they copy a human or agent invite, then the copied URL uses the Thinkroom origin and the copy names Thinkroom.
- AE4. Given an existing visitor on the Pruf hostname, when the release loads, then their stored mode, panel, focus, identity, and claim-banner preferences remain available because legacy storage keys are preserved.
- AE5. Given a raw or JSON agent fetch through either hostname, when the guide is returned, then it names Thinkroom while documenting the same API contract.

## Implementation units

### U1. Brand contract regression coverage

- **Goal:** Establish failing coverage for the new public name and dual-host behavior before changing implementation.
- **Files:** `test/integration/branding_test.rb`, `test/integration/agent_discovery_test.rb`, `script/browser_check.mjs`.
- **Patterns:** Existing Inertia assertions in `test/integration/identity_flow_test.rb`; browser smoke checks in `script/browser_check.mjs`.
- **Test scenarios:** Home response and layout metadata identify Thinkroom; agent guides contain Thinkroom and not public Pruf copy; browser wordmark, tagline, document monogram, share invite, and theme label use Thinkroom; Host headers for both production names resolve the same routes.
- **Verification:** Run the focused Rails integration tests and relevant browser checks before and after the implementation.

### U2. Human-facing Thinkroom identity

- **Goal:** Replace visible Pruf identity with Thinkroom and apply the approved strategy copy.
- **Files:** `app/frontend/pages/documents/index.tsx`, `app/frontend/pages/documents/show.tsx`, `app/frontend/components/feedback_button.tsx`, `app/frontend/components/share_popover.tsx`, `app/frontend/components/theme_picker.tsx`, `app/views/layouts/application.html.erb`, `app/views/pwa/manifest.json.erb`.
- **Patterns:** Keep Inertia `Head` ownership in page components and server-owned install metadata in Rails views.
- **Test scenarios:** The home page shows Thinkroom and the approved one-liner; document pages show `T.`; feedback, sharing, theme, browser title, app icons, and PWA identity contain no visible Pruf references.
- **Verification:** Type-check the frontend and run Playwright on the home, document, share, and theme surfaces.

### U3. Agent and content-contract terminology

- **Goal:** Rename agent-facing guidance and non-persistent semantic identifiers without changing protocol behavior.
- **Files:** `app/services/agent_guide.rb`, `app/services/html_document_sanitizer.rb`, `app/frontend/editor/document_format.ts`, `app/frontend/editor/clipboard.ts`, `app/frontend/editor/milkdown_editor.tsx`, `test/services/html_document_sanitizer_test.rb`, `test/services/document_plain_text_test.rb`.
- **Patterns:** Preserve all `data-*` attribute names and trusted/external sanitization behavior; only names and public wording change.
- **Test scenarios:** Trusted metadata still round-trips, external metadata remains stripped, clean clipboard behavior is unchanged, and agent help uses Thinkroom terminology.
- **Verification:** Run service tests, TypeScript checks, and the existing HTML/browser regressions.

### U4. Public documentation and compatibility identifiers

- **Goal:** Present Thinkroom’s strategy, credit inspiration from Proof by Dan Shipper, and document which legacy identifiers intentionally remain.
- **Files:** `README.md`, `STRATEGY.md`, `Dockerfile`, selected comments near preserved `pruf:*` storage keys.
- **Patterns:** Keep repository-local setup commands and API examples executable; describe the project as open source and agent-native without claiming an embedded agent.
- **Test scenarios:** README links and local setup remain valid; a scoped search finds no stale public Pruf branding outside explicitly documented compatibility identifiers and historical artifacts.
- **Verification:** Run link/search checks and inspect the final rendered README.

### U5. Thinkroom application icon

- **Goal:** Replace the placeholder red-circle icon with a legible Thinkroom mark that fits the existing warm-paper and dark-ink interface.
- **Files:** `public/icon.svg`, `public/icon.png`, and the icon references in `app/views/layouts/application.html.erb` and `app/views/pwa/manifest.json.erb` if their metadata needs adjustment.
- **Patterns:** Keep one deterministic SVG source and derive the 512×512 PNG used by the PWA; use a simple `T` monogram that remains recognizable at favicon size and does not introduce an asset-generation dependency.
- **Test scenarios:** SVG and PNG assets load successfully, the PNG remains 512×512, favicon/PWA references resolve, and the mark remains legible at 32px and 192px previews.
- **Verification:** Inspect the source and rendered assets visually, verify dimensions/file types, and load the favicon and install metadata in the browser.

### U6. Dual-domain production release

- **Goal:** Add the new hostname without disrupting the existing hostname or data plane.
- **Files:** `config/deploy.yml` plus external DNS configuration for `thinkroom.kieranklaassen.com`.
- **Patterns:** Kamal 2.11 `proxy.hosts` multi-host configuration; existing remote builder, service, image, and volume configuration remain unchanged.
- **Test scenarios:** DNS resolves both names to `5.78.191.151`; Kamal config validates; deployment issues TLS for both names; both HTTPS origins load the home page and the same disposable document; Action Cable reaches live status on both.
- **Verification:** Validate configuration before deploy, confirm the diff and secret scan contain no credential material, inspect the active container, then run HTTP and Playwright checks against both domains.

## System-wide impact

- **Data and persistence:** No database or Yjs migration. Both domains use the existing `pruf_storage` volume and the same document records.
- **Browser state:** Storage and cookies are origin-scoped. Existing Pruf-origin state remains intact; the new Thinkroom origin begins with fresh per-browser preferences while sharing server-side documents.
- **Agents:** Agent clients can use either domain. Existing Pruf URLs and all API endpoints remain valid.
- **Operations:** Certificate issuance now depends on two DNS names. A missing Thinkroom record would make the first dual-host deploy unsafe.

## Risks and dependencies

- DNS is delegated to `googledomains.com` nameservers, and no authenticated DNS CLI is currently detected. Implementation must locate an authorized management path or record the exact manual blocker before deploying the multi-host config.
- Deployment and DNS access must reuse machine-local credentials without copying SSH keys, API tokens, or credential files into the repository.
- A global string replacement could rename compatibility identifiers and reset local preferences or detach the persistent volume. Changes must distinguish public branding from stable infrastructure.
- Search results include historical plans, dogfood reports, and generated Vite assets. Historical artifacts should remain unchanged; generated assets must not be hand-edited.
- The untracked `STRATEGY.md` belongs to this product rename and must be preserved through branch creation and final commit.

## Documentation and operational notes

- Deploy only after `thinkroom.kieranklaassen.com` resolves publicly to the Hetzner host.
- Keep `pruf.kieranklaassen.com` in smoke tests and operational documentation as a supported legacy hostname.
- After release, verify the new-version WebSocket notice and share-link origin behavior from a tab on each hostname.

## Sources

- `STRATEGY.md` for the approved product name, target problem, approach, and tagline.
- `config/deploy.yml` for the current single-host production topology and compatibility-sensitive service identifiers.
- Kamal 2.11 local configuration reference at `lib/kamal/configuration/docs/proxy.yml` within the installed gem for `proxy.hosts` behavior.
- `app/frontend/pages/documents/index.tsx`, `app/frontend/pages/documents/show.tsx`, and `app/services/agent_guide.rb` for the current public brand surfaces.
