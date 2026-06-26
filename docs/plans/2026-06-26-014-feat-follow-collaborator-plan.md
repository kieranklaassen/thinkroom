---
title: "feat: Follow a collaborator's viewport"
type: feat
date: 2026-06-26
issue: 83
---

# Follow a collaborator's viewport

## Outcome

Clicking a present collaborator's avatar follows their reading position live, like Figma's follow mode, until the follower navigates independently or toggles follow off.

## Requirements

1. Every connected human publishes an ephemeral viewport anchor through the existing Yjs awareness channel.
2. Human presence avatars are real buttons with a clear follow/unfollow label and active state.
3. Following keeps the selected collaborator's document position at the same comfortable viewport line across different window sizes.
4. Wheel, touch, pointer, or navigation-key input immediately releases follow; programmatic follow scrolling does not.
5. Switching targets, clicking the active target again, disconnecting, or unmounting cleans up follow state.
6. Viewport anchors use Yjs relative positions so edits do not invalidate them and never write or persist document content.
7. Agents remain presence-only because API presence exposes a semantic location, not a live viewport.

## Implementation

- Add a collaboration viewport module that publishes a throttled, deduplicated relative position and follows a selected awareness client.
- Preserve awareness client IDs in the page's human peer state and pass follow state/actions into `PresenceBar`.
- Render human avatars as accessible buttons with a selected ring and a compact `Following …` status.
- Bind viewport publication for every live editor and bind remote scrolling only while a peer is selected.
- Add browser coverage for starting follow, remote scrolling, manual release, disconnect cleanup, and content immutability.

## Verification

- TypeScript, RuboCop, full Rails suite, and production Vite build.
- Two-browser local test at different viewport sizes: click peer, follow both directions, release by manual input, and handle disconnect.
- Production two-session smoke test followed by temporary-document cleanup.
