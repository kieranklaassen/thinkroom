# Contributing to Thinkroom

Contributions are welcome through issues and pull requests. Please keep each
change focused, explain the user-facing outcome, and include tests for behavior
changes.

## Local setup

Install Ruby 3.4.2, Node 22, SQLite, and libvips, then run:

```bash
bin/setup
bin/dev
```

The application is available at <http://localhost:3000>.

## Before opening a pull request

Run the checks relevant to your change. The complete CI-equivalent set is:

```bash
npm run check
npm audit --omit=dev --audit-level=moderate
bin/vite build --mode test
bin/rails db:test:prepare test
bin/rubocop
bin/brakeman --no-pager
bin/bundler-audit
```

Never commit credentials, private keys, production data, local SQLite files,
uploads, or feedback recordings. Report security problems privately according
to [SECURITY.md](SECURITY.md).

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
