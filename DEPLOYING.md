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
