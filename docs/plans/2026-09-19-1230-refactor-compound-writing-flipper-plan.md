---
title: "Compound Writing Feature Flag on Flipper - Plan"
type: refactor
date: 2026-09-19
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Compound Writing Feature Flag on Flipper - Plan

## Goal Capsule

- **Objective:** Feature management in Thinkroom works the way it does in Cora: Flipper with the ActiveRecord adapter, plain `Flipper.enabled?(:flag, user)` checks, Flipper UI under `/admin` for admin accounts. The round-two `users.features` column, `Features` concern, `features:*` tasks, and the `COMPOUND_WRITING_INITIAL_ACCOUNTS` bootstrap go away; Kieran's grant carries over.
- **Means:** Flipper gems and tables (KTD1), `available_to?` delegating to Flipper (KTD2), an admin column and a route constraint protecting Flipper UI (KTD3), a data migration that moves grants and drops the column (KTD4), and lazy first-pack seeding on first visit (KTD5).
- **Authority:** Cora's shape (`EveryInc/cora` main: `config/initializers/flipper.rb`, `config/flipper_flag_defaults.yml`, `config/routes/admin.rb` under `authenticated :user, ->(u) { u.admin? }`, `Flipper.enabled?` in controllers, `Flipper.enable(:flag, user)` in tests, flag-retirement migrations) governs mechanism; round two's plan still governs packs and gating semantics.
- **Stop conditions:** Escalate any change to document authorization or the pack model.

## Product Contract

### Requirements

- R1. `compound_writing` is a Flipper feature; `CompoundWriting.available_to?(user)` stays the single gate and returns `user.present? && Flipper.enabled?(:compound_writing, user)`.
- R2. A data migration enables the flag for every account holding the old `features["compound_writing"]` grant, then drops `users.features`; `Features`, `features:*`, and the initial-accounts bootstrap are removed.
- R3. Flipper UI is mounted at `/admin/flipper` and reachable only by signed-in admin accounts (`users.admin`, promoted by `admin:grant[email]` or `THINKROOM_ADMIN_EMAILS` at migrate time); everyone else gets 404, like Cora's `authenticated` block.
- R4. `config/flipper_flag_defaults.yml` documents the flag (disabled by default everywhere; production never auto-enables), loaded once at boot as in Cora.
- R5. The first pack is subscribed lazily: an enabled account with no seeding yet gets `EveryInc/compound-writing` at the pinned SHA on its first Comment-mode visit, once (`users.compound_writing_seeded_at`), so a later deliberate removal sticks.
- R6. Tests enable the flag in setup (`Flipper.enable(:compound_writing, user)`); the browser check and CI still prepare a featured check account; docs updated.

### Acceptance Examples

- AE1. After deploy, `Flipper.enabled?(:compound_writing, User.find(1))` is true on production without anyone touching the UI; `users.features` is gone.
- AE2. Signed out, `/admin/flipper` is 404; as an admin it renders the features list; as a non-admin signed-in account it is 404.
- AE3. An account enabled through Flipper UI opens a document in Comment mode and sees the Compound Writing pack with 13 lenses without an operator step; removing that pack and reloading does not bring it back.

## Key Technical Decisions

- KTD1. **Gems and adapter as in Cora.** `flipper`, `flipper-active_record`, `flipper-ui` (`~> 1.3`), tables from `flipper:active_record`, `config.flipper.preload = false` (Cora's setting; memoization stays on). Governs R1.
- KTD2. **Plain checks, one gate.** Per Cora's convention doc (prefer plain Flipper checks over policy abstractions), controllers keep calling `CompoundWriting.available_to?(current_user)`, which is the flag check plus the signed-in guard, and nothing else. Governs R1.
- KTD3. **Admin column and route constraint.** Thinkroom has no Devise, so `AdminConstraint` reads `session[:user_id]` and requires `User#admin?`; the mount sits inside `constraints(AdminConstraint.new)` so a miss falls through to 404. Governs R3.
- KTD4. **Migration order.** `create_flipper_tables`, `add_admin_and_compound_writing_seeded_at_to_users`, then `move_compound_writing_feature_to_flipper` (SQL read of the JSON column, `Flipper.enable_actor` per account, promote `THINKROOM_ADMIN_EMAILS`, drop `features`). The round-two bootstrap migration becomes a documented no-op. Governs R2, R3.
- KTD5. **Lazy first pack.** `CompoundWriting::FirstPack.ensure_pack!` (offline from the curated set) and `FirstPack.seed!(user)` (subscribe once, stamp `compound_writing_seeded_at`), called from `documents#show` when the viewer is enabled. Chosen over boot-time subscription of flag holders because accounts enabled later in the UI would otherwise wait for a deploy. Governs R5.

## Implementation Units

- U1. Gems, tables, initializer, defaults YAML, `preload = false`, `AdminConstraint`, `/admin/flipper` mount, `users.admin`, `admin:*` tasks.
- U2. `available_to?` on Flipper; remove `Features`, `features.rake`, initial-accounts env and tests; `flags:*` tasks (enable, disable, list) as thin wrappers since Flipper ships no CLI.
- U3. Data migration moving grants and dropping the column; round-two bootstrap migration to a no-op.
- U4. `FirstPack` (rename of `Bootstrap`), lazy seed in `documents#show`, `compound_writing_seeded_at`, `check_account` and `install` tasks on Flipper.
- U5. Tests (helpers, flags tasks, admin constraint, migration behavior, lazy seed), CI, docs.

## Verification

`bin/rails test`, `npm run check`, `bin/rubocop`, browser check locally, CI green, deploy from the worktree with `THINKROOM_ADMIN_EMAILS` set, live: `Flipper.enabled?` for Kieran via `bin/kamal app exec`, signed-out gate, `/admin/flipper` 404 signed out.
