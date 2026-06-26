---
title: "feat: Auto-claim fresh documents for signed-in users"
type: feat
status: active
date: 2026-06-26
issue: 89
---

# Auto-claim fresh documents for signed-in users

## Goal

When an authenticated person opens an unclaimed document created within the last 10 minutes, assign it to their account automatically so agent-created handoffs do not require a second claim click.

## Safety boundaries

- Only a signed-in user can trigger auto-claim.
- Only unclaimed, claimable documents younger than 10 minutes qualify.
- Only a real browser page navigation qualifies. Agent/text/JSON reads, link unfurlers, prefetch requests, and Inertia partial reloads remain side-effect free.
- The model's existing conditional claim update remains the ownership authority. A concurrent winner is respected and the page still loads normally.
- The transition records the existing claim activity and broadcasts the existing ownership/activity events, so other open clients reconcile normally.
- Explicit claim remains available for older unclaimed documents.

## Implementation

1. Add a named 10-minute window and a private guarded auto-claim helper to `DocumentsController`.
2. Invoke it only after agent/JSON/text exits and before the browser page's ownership/activity props are assembled.
3. Add integration coverage for a qualifying signed-in navigation, guest navigation, stale documents, prefetch, partial reload, link preview, and a lost ownership race.
4. Add a focused browser check proving the claim banner disappears, the header reports account ownership, the document appears under the account's home list, and cleanup succeeds.

## Verification

- `bin/rails test test/integration/ownership_flow_test.rb`
- `bin/rails test`
- `bin/rubocop`
- `npm run check`
- focused signed-in browser verification at desktop and mobile widths
- production build, deploy, and production verification
