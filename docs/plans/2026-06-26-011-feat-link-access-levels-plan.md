---
title: "feat: Expand shared-link access to view, comment, or edit"
type: feat
date: 2026-06-26
issue: 77
---

# feat: Expand shared-link access to view, comment, or edit

## Summary

Replace the owner’s binary “Read only for others” switch with one document-wide shared-link role: Can edit, Can comment, or Can view. Owners keep full control; everyone else receives the capability attached to the link, with matching mode URLs, UI affordances, browser writes, and Agent API enforcement.

## Requirements

- R1. Every document has one shared-link access level: `edit`, `comment`, or `view`; new documents default to `edit` to preserve today’s collaboration behavior.
- R2. The owner can change link access from the document options dialog using an explicit three-choice control with clear labels and selected state.
- R3. Owners always retain Edit, Suggest, Comment, and Read access regardless of the selected link role.
- R4. A link editor can use every mode and all existing document/comment/suggestion actions.
- R5. A link commenter can open Comment and Read modes, create and resolve comments, but cannot enter Edit or Suggest, mutate Yjs content, toggle tasks, submit suggestions, or write snapshots/sync updates.
- R6. A link viewer can only use Read mode and cannot create or resolve comments or perform document writes.
- R7. Direct `/edit`, `/suggest`, and `/comment` URLs enforce the same capability matrix. Unavailable mode URLs redirect to canonical `/d/:slug`; a live access downgrade replaces an unavailable URL with canonical Read.
- R8. The mode dropdown leaves permitted modes enabled and visibly disables unavailable modes. It remains fully disabled only for view-only visitors and the fixed Edit demo.
- R9. Browser comments and Agent API comments use comment-level authorization; all document/suggestion writes continue to require edit-level authorization.
- R10. The Agent API state and guide expose `link_access`, `can_write`, and `can_comment`, while retaining `editing_locked` as a compatibility field during the transition.
- R11. Existing documents migrate from `editing_locked=false` to `edit` and `editing_locked=true` to `view`. Existing owners, links, document state, and access endpoints remain safe across a rolling deploy.
- R12. Access remains per-document/per-link only. Inviting named users, separate URLs/tokens, email ACLs, and account-specific sharing are out of scope.

## Key Decisions

- KTD1. Add a constrained `link_access` string instead of composing more booleans. The enum is the authoritative, extensible policy; the existing `editing_locked` column/field remains temporarily synchronized for old clients and rolling-deploy compatibility.
- KTD2. Model the access lattice explicitly: `edit` implies write + comment + read; `comment` implies comment + read; `view` implies read only. Owner checks sit above the lattice and always grant full access.
- KTD3. “Can comment” does not enable Suggest mode. Suggest edits are Yjs document mutations; allowing them would require accepting content-write authority and would let a forged collaborator bypass tracked-change UI. This iteration grants the capability named by the role: comments only.
- KTD4. Split comment authorization from document-write authorization on both browser and Agent API paths. Presence, state, and event reads remain available at every level.
- KTD5. Use a native radiogroup-style control in the Access section. The three choices are mutually exclusive policy values, not a binary toggle, and should be understandable without opening a second modal.
- KTD6. Reuse the mode-specific URLs shipped in issue #76. Server routing and client `changeMode` share the same capability predicate so disabled UI and direct-link behavior cannot drift.
- KTD7. Keep `PATCH /d/:slug/editing_lock` as a compatibility adapter (`false` → edit, `true` → view) while adding the explicit owner-only `PATCH /d/:slug/link_access` endpoint.
- KTD8. Broadcast the existing access-change event after any role transition so both old and new mounted clients reload ownership permissions during the rolling transition.

## Implementation Units

### U1. Link-access domain model and migration

- **Files:** new migration, `db/schema.rb`, `app/models/document.rb`, model tests
- **Approach:** Add `link_access` with an `edit|comment|view` constraint/default and backfill from `editing_locked`. Add `writable_by?`, `commentable_by?`, assertion/lock helpers, a single owner-only `set_link_access!`, compatibility mapping for `set_editing_locked!`, and ownership props for access/capabilities. Persist the compatibility boolean alongside the enum.
- **Verification:** Tests cover defaults, backfill semantics, all owner/guest capability combinations, invalid values, atomic owner authorization, activity logging, compatibility mapping, and token non-disclosure.

### U2. Owner access controls and live reconciliation

- **Files:** `config/routes.rb`, `app/controllers/documents_controller.rb`, `app/frontend/components/header_menu.tsx`, `app/frontend/components/ownership_chip.tsx`, CSS, ownership integration tests
- **Approach:** Add the explicit owner-only update action and replace the binary menu row with a labelled three-choice link-access group. Optimistically update the owner’s props, keep failures recoverable, show non-owners the active link role, and broadcast/reload the access state.
- **Verification:** Owner can select all three roles; non-owner cannot update them; only real changes log/broadcast; selected state, keyboard focus, touch targets, and failure recovery are correct.

### U3. Capability-aware mode URLs and editor UI

- **Files:** `app/controllers/documents_controller.rb`, `app/frontend/pages/documents/show.tsx`, `app/frontend/components/mode_control.tsx`, routing tests
- **Approach:** Permit explicit modes through a shared access matrix. Pass available modes to ModeControl, disable unavailable choices, keep Comment accessible to commenters, mount commenters through the read-only sync provider, and canonicalize any current mode that becomes unavailable after an access change.
- **Verification:** Editors get four modes; commenters get Comment/Read; viewers get Read only; direct routes and live downgrades match; Comment mode remains non-editable and task controls stay inert.

### U4. Browser and Agent API comment authorization

- **Files:** `app/controllers/concerns/document_write_authorization.rb`, `app/controllers/comments_controller.rb`, `app/controllers/api/base_controller.rb`, `app/controllers/api/comments_controller.rb`, API/browser integration tests
- **Approach:** Add comment-level guarded blocks and a distinct helpful access error. Route comment create/resolve through them while leaving suggestions, snapshots, sync, and source updates on write-level guards.
- **Verification:** Commenters can create/resolve comments from browser and API; viewers receive 423; commenters receive 423 for suggestions/document writes; editors retain all behavior.

### U5. Discovery and end-to-end regression coverage

- **Files:** `app/services/agent_guide.rb`, `script/browser_check.mjs`, discovery tests
- **Approach:** Teach agents the three roles and capability fields. Add a two-browser flow that changes owner access, verifies route/UI enforcement, posts a commenter comment live, downgrades to View, and restores Edit before cleanup.
- **Verification:** Focused browser checks pass at desktop and mobile; full Rails/TypeScript/lint/build gates pass; production verification uses a temporary owner document and deletes it.

## Acceptance Examples

- AE1. Given an owned document, when the owner chooses Can comment, then Access shows that choice selected and another browser can open `/comment` but `/edit` and `/suggest` redirect to the Read URL.
- AE2. Given that commenter in Comment mode, when they select text and post a comment, then it appears live for the owner while the document remains non-editable.
- AE3. Given the same commenter, when they call the suggestion API or submit a snapshot, then the server returns 423 with the current `link_access` and a useful next action.
- AE4. When the owner changes the role to Can view, then the commenter’s open `/comment` page moves to canonical Read, the mode control locks, and comment creation returns 423.
- AE5. When the owner changes the role to Can edit, then another link visitor can open `/edit`, type, suggest, comment, and use tasks as before.
- AE6. Given an older document whose binary lock was enabled, after migration it has `link_access=view`; an unlocked older document has `link_access=edit`.

## Risks

- Comment authorization currently reuses the write lock. Missing either browser or API comments would make the role look enabled while requests fail; cover create and resolve on both surfaces.
- Comment mode needs selection/comment UI but must use the read-only Yjs provider. Keep `canWrite=false` while allowing HTTP comments, and test that task/content mutations remain blocked.
- Access events can arrive while a visitor is on a now-invalid mode URL. Reconcile both server partial reloads and client props, replacing rather than pushing the canonical Read entry.
- Removing `editing_locked` immediately would break the old container during deployment. Keep and synchronize it until a later cleanup after all clients and servers understand `link_access`.
- Optimistic owner controls can drift on a rejected update. Scope the reload to ownership/activities and reset updating/error state on completion.
