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

Both local files are ignored by Git. Never commit registry tokens, the Rails
master key, SSH private keys, or production `.env` files.

## Deploy

Load the non-secret deployment identifiers into the shell, validate the
rendered configuration, and deploy:

```bash
set -a
source .kamal/deploy.env
set +a

bin/kamal config
bin/kamal deploy
```

DNS for every `KAMAL_PROXY_HOSTS` entry must point to a configured host before
the first TLS-enabled deploy.
