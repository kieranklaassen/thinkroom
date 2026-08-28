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

Put the resulting token in `.kamal/deploy.env`:

```bash
WEBMCP_ORIGIN_TRIAL_TOKEN=...
```

The token is public, bound to its origin, and signed by Google — it is not a
secret and does not belong in `.kamal/secrets`. `config/deploy.yml` passes it
through `env.clear`; when it is unset, the layout emits no origin-trial meta
tag and WebMCP still works in browsers with the testing flag enabled.

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
