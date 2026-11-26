---
title: Separate Google Account for an Email a Password Account Uses - Plan
type: feat
date: 2026-11-26
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Separate Google Account for an Email a Password Account Uses - Plan

## Goal Capsule

- **Objective:** Someone with a verified Google email can sign in with Google on the first try, whether or not a password account uses that email.
- **Means:** The two accounts stay separate; the Google account stores a reserved form of the address when the plain one is taken (KTD1).
- **Authority:** Requirements govern behavior; KTDs govern mechanism.
- **Execution profile:** One PR, two units, native execution.
- **Stop conditions:** Stop if the work needs a schema change, a data migration, outgoing mail, or a change to an existing account.
- **Ownership:** The run that wrote this plan implements it and opens the PR. Merging is the owner's.

## Product Contract

### Summary

A verified Google sign-in for an email that a password account uses creates its own new account. The password account keeps its password, documents, pins, sessions, and CLI tokens.

### Problem Frame

Today that sign-in ends at the login page with a request to use the password.

### Requirements

- R1. A verified Google callback with an unknown subject, whose email belongs to a password account, creates and signs in a new Google account. Later callbacks with that subject reach the same account.
- R2. Nothing moves between the two accounts. The password account's row is not written.
- R3. The Google account shows its plain email in the page, CLI authorization, and CLI API responses, and counts as that email for feedback automation.
- R4. A Google callback whose email belongs to another Google account is refused, as today.
- R5. A registration finishing during the callback does not fail the Google sign-in.
- R6. Registration refuses an address in the reserved form with the existing message. Existing accounts are not revalidated.
- R7. An operator task given an email that two accounts answer to stops and prints the id and stored address of each; an account id selects one.

### Scope Boundaries

- Deferred: linking a password account to Google, email verification, password reset.
- Out of scope: password sign-in, session length, rate limits, return paths.

## Planning Contract

### Key Technical Decisions

- KTD1. **Reserved address.** `users.email` is unique and NOT NULL, so on R1 only, the Google user stores `<email>.<subject>.google.invalid`. `.invalid` is a reserved top-level domain, the value passes the existing format check, and the subject keeps it unique. Rejected: rewriting the password account's address, because reverting the release would then stop that person's password sign-in.
- KTD2. **One reader.** `User#account_email` gives the plain address and `User#public_identity` gives id, name, and that address. The `email` attribute keeps the stored value so uniqueness validation is unaffected.
- KTD3. **Resolve again.** When the insert loses on the unique index, the callback resolves from the start, up to twice, because a registration and another callback can each finish first.

### Assumptions

- Google subjects are digits, so the suffix is a valid domain label.

## Implementation Units

### U1. Separate Google account

- **Goal:** R1 to R6.
- **Files:** `app/models/user.rb`, `app/controllers/oauth_callbacks_controller.rb`, `app/controllers/inertia_controller.rb`, `app/controllers/cli_authorizations_controller.rb`, `app/controllers/api/cli/device_authorizations_controller.rb`, `app/controllers/api/cli/sessions_controller.rb`, `app/services/feedback_automation.rb`, `test/integration/google_oauth_flow_test.rb`, `test/integration/authentication_flow_test.rb`, `test/models/user_test.rb`
- **Approach:** KTD1 to KTD3.
- **Test scenarios:** first and repeat Google sign-in; documents, pins, CLI token, open session, and password sign-in of the password account unchanged; email held by Google refused; lost insert; reserved address refused at signup; plain email in props and CLI responses; feedback automation.
- **Verification:** the new tests fail before the change and pass after it.

### U2. Operator tasks

- **Goal:** R7.
- **Files:** `app/models/user.rb`, `lib/tasks/flags.rake`, `lib/tasks/compound_writing.rake`, `test/tasks/flags_tasks_test.rb`
- **Approach:** one lookup shared by the tasks; find accounts by stored address, plain address, or id.
- **Test scenarios:** shared email stops with both ids; an id selects its account; single accounts behave as today.
- **Verification:** the task tests.

## Verification Contract

`bin/rails test` on the files above plus `test/integration/cli_authentication_flow_test.rb`, `test/integration/feedback_runs_test.rb`, and `test/channels/application_cable/connection_test.rb`; `npm run check`; `bin/rubocop`; `bin/brakeman`.

## Definition of Done

Requirements R1 to R7 are covered by passing tests, the listed checks pass, and no abandoned code remains.
