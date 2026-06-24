# Security policy

## Supported version

Thinkroom is currently pre-1.0. Security fixes are made on the latest commit of
the `main` branch; older commits and deployments are not supported.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
vulnerability reporting flow from this repository's **Security** tab. Include
the affected endpoint or component, reproduction steps, impact, and any
suggested mitigation.

Maintainers will acknowledge a report as soon as practical, validate it,
coordinate a fix, and credit the reporter unless anonymity is requested.

## Current trust model

- A document's share URL is its access boundary. Anyone with the URL can read
  the document and may be able to comment, suggest, or edit according to the
  selected mode.
- `X-Agent-Name` records attribution; it is not authentication and must not be
  treated as proof of identity.
- Browser ownership tokens authorize destructive owner actions. They are
  stored in signed, HTTP-only cookies and are not user accounts.
- Operators are responsible for keeping `config/master.key`, `.kamal/secrets`,
  SSH private keys, registry credentials, and production environment files out
  of source control.

Do not use the current pre-1.0 release for confidential or regulated data
without adding access controls appropriate to that deployment.
