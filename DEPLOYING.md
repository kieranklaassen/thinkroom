# Deploying Thinkroom

Thinkroom ships with an environment-driven [Kamal](https://kamal-deploy.org/)
configuration so a public checkout does not expose an operator's hosts,
registry account, or SSH topology.

## Configure the deployment

Copy the deployment environment template and replace every placeholder:

```bash
cp .kamal/deploy.env.example .kamal/deploy.env
```

If this is an existing deployment, keep its current `KAMAL_SERVICE` and
`KAMAL_STORAGE_VOLUME` values. Changing either can create a separate Kamal
application or detach the app from its existing SQLite data.

Put secret values in `.kamal/secrets`:

```bash
KAMAL_REGISTRY_PASSWORD=$KAMAL_REGISTRY_PASSWORD
RAILS_MASTER_KEY=$RAILS_MASTER_KEY
CURSOR_API_KEY=$CURSOR_API_KEY
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET
```

`.kamal/secrets.example` contains the complete safe-to-copy key list. Google
sign-in is enabled only when both Google values are present. Set
`KAMAL_GOOGLE_OAUTH=1` in `.kamal/deploy.env` when those secrets are configured;
leave it unset to deploy without Google. Password accounts and anonymous
documents do not require an email provider.

Feedback-to-PR automation is disabled unless both `CURSOR_API_KEY` is available
and `RIFFREC_AUTOMATION_EMAILS` contains the signed-in account. Set the latter
to a comma-separated allowlist in `.kamal/deploy.env`, for example:

```bash
RIFFREC_AUTOMATION_EMAILS=maintainer@example.com
```

Captured Riffrec ZIPs are private Active Storage attachments. Cursor receives a
purpose-scoped bundle URL that expires after 24 hours; generated pull requests
are never merged or deployed automatically.

### Feature flags (Flipper)

Feature flags work as they do in Cora: [Flipper](https://www.flippercloud.io/docs)
with the ActiveRecord adapter (`flipper_features`, `flipper_gates`), plain
`Flipper.enabled?(:flag, user)` checks in code, and Flipper UI for managing
them. `config/flipper_flag_defaults.yml` lists every flag with its purpose;
flags listed there that do not exist yet are registered at boot, disabled in
production whatever the YAML says, so a new flag is always opt-in.

Flipper UI is mounted at `/admin/flipper` behind `AdminConstraint`: only a
signed-in account with `users.admin` reaches it; everyone else gets 404.
`THINKROOM_ADMIN_EMAILS` (comma-separated, in `.kamal/deploy.env`, passed
through `env.clear`) names the accounts the `MoveCompoundWritingFeatureToFlipper`
migration promotes; later promotions need no deploy:

```bash
bin/kamal app exec --reuse 'bin/rails "admin:grant[someone@example.com]"'
bin/kamal app exec --reuse 'bin/rails "flags:enable[compound_writing,someone@example.com]"'
bin/kamal app exec --reuse 'bin/rails "flags:list[compound_writing]"'
```

(`flags:*` and `admin:*` are thin wrappers for the console-less container;
Flipper itself has no CLI. Flipper UI is the primary way to enable a flag for
an account, a group such as `admins`, a percentage, or everyone.) Every
enable, disable, add, and remove is logged with its target.

### Compound writing (TypeSafe Jev, flagged accounts)

Compound writing lives in Comment mode for accounts with the
`compound_writing` flag enabled: their reviewers panel runs the lenses of the
packs they subscribed to, and TypeSafe's Jev answers each lens's yes/no
questions over the document. Everyone else sees no panel, no props, and the
pass and pack endpoints refuse them. It needs a TypeSafe API key from
<https://console.typesafe.ai>. Add it to `.kamal/secrets` as
`TYPESAFE_API_KEY=$TYPESAFE_API_KEY` and set `KAMAL_COMPOUND_WRITING=1` in
`.kamal/deploy.env`; without the flag the container receives no key and the
panel shows a "not configured" notice instead of running reviewers.
`TYPESAFE_MODEL` (default `jev-latest`) may be set in `env.clear` if needed.

An enabled account is subscribed to the first pack, `EveryInc/compound-writing`
at commit `8fd0ec88c00976cf0274cb76552dc7ad9405ca92` (built offline from
`config/compound_writing/lenses/everyinc--compound-writing.yml`), on its first
Comment-mode visit, once; removing it later sticks. Other packs are added from
the panel or with `bin/rails "compound_writing:install[owner/repo,someone@example.com]"`.

Packs are fetched through `ruby_llm-skills`' marketplace layer over HTTPS
(api.github.com, raw.githubusercontent.com, codeload.github.com; no `git` in
the image is needed). Each install is an immutable version row keyed by
locator, plugin, and the commit the ref resolved to; re-adding a locator moves
only the requester's subscription, never another account's. A plugin must live
in the marketplace repository itself (a relative source, or a `github` source
naming the same owner/repo); archives, hosted URLs, and other repositories are
refused. Pack-authored text is bounded before it is stored (lenses per pack,
questions per lens, field lengths, single-line printable text), and a pack
that breaks a bound fails to install.

`MARKETPLACE_GITHUB_TOKEN` (optional, `env.clear`) is sent with marketplace
fetches to lift GitHub's anonymous rate limit. Use a token with public read
access only (a fine-grained token with no repository access, or a classic
token with no scopes): it travels with every fetch a featured account
triggers, and the code never falls back to a broader `GITHUB_TOKEN`. How a
pack's `SKILL.md` files become lenses is in `docs/compound-writing-packs.md`.

Every pass spends against that shared key, so passes are bounded. An enabled
account with write access to a document can start one, but only one pass runs
per document at a time, a document waits `COMPOUND_WRITING_COOLDOWN_SECONDS`
(60) between passes, and a rerun with the same text and reviewers returns the
finished pass instead of spending; a failed pass can always be rerun. Daily
caps answer 429 and count only passes that actually started, per fixed UTC day:
`COMPOUND_WRITING_DOCUMENT_DAILY_PASSES` (40 per document) and
`COMPOUND_WRITING_IP_DAILY_PASSES` (100 per client address). A pass is refused
up front when its estimate exceeds
`COMPOUND_WRITING_MAX_NOULS_PER_PASS` (20,000 questions) or
`COMPOUND_WRITING_MAX_JEV_CALLS_PER_PASS` (1,500 TypeSafe requests), and the
process never has more than `COMPOUND_WRITING_MAX_CONCURRENT_JEV_CALLS` (4)
requests in flight. A pass still running after `COMPOUND_WRITING_STALL_SECONDS`
(600) is treated as abandoned and may be replaced. Set any of these in
`env.clear` to tune a deployment.

For local development put the key in an untracked `.env` at the repo root;
`bin/dev` (overmind or foreman) loads it. `bin/rails console` and
`bin/rails test` do not read `.env`. To exercise the mode without a key, run
with `COMPOUND_WRITING_FAKE_JUDGE=1`, which substitutes a deterministic
lexicon judge outside production.

Create a Google OAuth web application with these production redirect URIs:

```text
https://thinkroom.kieranklaassen.com/auth/google_oauth2/callback
https://pruf.kieranklaassen.com/auth/google_oauth2/callback
```

### WebMCP origin trial

Thinkroom pages register WebMCP tools for agents driving Chrome 149+. For the
production origins to take part in Chrome's origin trial, register both at
<https://developer.chrome.com/origintrials/#/register_trial/4163014905550602241>:

```text
https://thinkroom.kieranklaassen.com
https://pruf.kieranklaassen.com
```

Each origin gets its own token. Put both in `.kamal/deploy.env`, separated by a
space (or a comma):

```bash
WEBMCP_ORIGIN_TRIAL_TOKEN="<thinkroom token> <pruf token>"
```

Tokens are public, bound to one origin each, and signed by Google — they are
not secrets and do not belong in `.kamal/secrets`. `config/deploy.yml` passes
the value through `env.clear`; the layout emits one origin-trial meta tag per
token and Chrome ignores the ones bound to another host. When the variable is
unset, no tag is emitted and WebMCP still works in browsers with the testing
flag enabled.

These local deployment files are ignored by Git. Never commit registry tokens,
the Rails master key, SSH private keys, or production `.env` files.

## Deploy

Run Kamal with the project Ruby from `.ruby-version`. macOS's system Ruby and
Bundler cannot parse this application's Gemfile platforms and will fail before
the deploy starts.

An isolated Git worktree does not inherit ignored files from the primary
checkout. Before deploying from a worktree, copy `.kamal/deploy.env`,
`.kamal/secrets`, and `config/master.key` into it, then verify that all three are
non-empty without printing their contents:

```bash
test -s .kamal/deploy.env
test -s .kamal/secrets
test -s config/master.key
```

Load the non-secret deployment identifiers, validate the rendered
configuration, and deploy:

```bash
export PATH="$HOME/.rbenv/versions/$(cat .ruby-version)/bin:$PATH"

set -a
source .kamal/deploy.env
set +a

bin/kamal config
bin/kamal deploy
```

DNS for every `KAMAL_PROXY_HOSTS` entry must point to a configured host before
the first TLS-enabled deploy.

## Repair a document's live state

Two rake tasks operate on one document's Yjs (CRDT) state by slug. Run them in
the deployed container, from the same shell that sourced `.kamal/deploy.env`:

```bash
# Fold the update tail and rewrite the stored state in canonical form.
# Content is unchanged; the previous blob is kept as a checkpoint archive.
# Safe to repeat: a second run reports "unchanged".
bin/kamal app exec --reuse 'bin/rails "yjs:compact[SLUG]"'

# Replace the live state with the document's saved source (the last accepted
# snapshot, or the seed). The wiped state is archived as a "replacement" row
# in yjs_state_archives, the content generation advances, and open editors
# reload. Use this when the live state has outgrown what the editor can load.
bin/kamal app exec --reuse 'bin/rails "yjs:reset[SLUG]"'
```

Both print before/after sizes and fail on an unknown slug. See
`docs/solutions/data-integrity/oversized-document-crdt-state.md` for when
each applies.

Run them on an idle document where possible: the task runs in its own
process, so only the row lock serializes it against live edits, and a
compaction of a multi-megabyte state holds that lock for its duration (live
frames that time out are dropped and logged as `merge failed`). The reset logs
a `reset_document` activity and reloads open editors through Action Cable;
that reload reaches other processes only with the database-backed cable
adapter production uses, not the development `async` adapter.

## Back up the SQLite database with Litestream

The CRDT blobs in `storage/production.sqlite3` are the only copy of every
document's live state — the content snapshots and HTML projections are lossy
derivations. The Kamal volume is a single point of failure, so stream the
database off-host with [Litestream](https://litestream.io/) before relying on
the deployment for real work.

Add a Litestream accessory to `config/deploy.yml` (adjust the bucket, region,
and endpoint for your object store; any S3-compatible target works):

```yaml
accessories:
  litestream:
    image: litestream/litestream:0.3
    hosts:
      - <your production host>
    volumes:
      - "<%= ENV.fetch("KAMAL_STORAGE_VOLUME") %>:/rails/storage"
    files:
      - config/litestream.yml:/etc/litestream.yml
    env:
      secret:
        - LITESTREAM_ACCESS_KEY_ID
        - LITESTREAM_SECRET_ACCESS_KEY
    cmd: replicate
```

With `config/litestream.yml`:

```yaml
dbs:
  - path: /rails/storage/production.sqlite3
    replicas:
      - type: s3
        bucket: your-backup-bucket
        path: thinkroom/production
        region: auto
        # endpoint: https://<account>.r2.cloudflarestorage.com  # non-AWS stores
```

Add the two secrets to `.kamal/secrets`, then `bin/kamal accessory boot litestream`.
The queue/cache/cable databases are derivable and do not need replication.

### Rehearse the restore before you need it

A backup that has never been restored is a hope, not a backup. On the host
(or any machine with the credentials):

1. Restore to a scratch path — never directly over the live file:
   `litestream restore -config /etc/litestream.yml -o /tmp/restored.sqlite3 /rails/storage/production.sqlite3`
2. Integrity-check the restored file:
   `sqlite3 /tmp/restored.sqlite3 "PRAGMA integrity_check;"` (expect `ok`) and
   spot-check `SELECT COUNT(*) FROM documents;`.
3. To actually fail over: stop the app (`bin/kamal app stop`), move the
   restored file into place on the volume, clear derived state that may be
   ahead of the restore (`DELETE FROM solid_cable_messages;` on the cable DB
   is safe — it is transient), and `bin/kamal app boot`.
4. Clients holding newer state than the restore point re-upload it through
   the sync handshake on reconnect; `yjs_state_archives` checkpoints inside
   the database itself cover shorter-horizon, per-document recovery.

Rehearse steps 1-2 quarterly; they are read-only and safe against production.
