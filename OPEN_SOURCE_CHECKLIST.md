# Open-source release checklist

Complete these repository-owner operations immediately before making the
repository public. They intentionally cannot be enforced by a code-only pull
request.

- [ ] Decide whether to rename the repository to `thinkroom`; update clone URLs
  and badges if it changes.
- [ ] Set the GitHub description to “Thinkroom — where deeper thinking
  compounds. Try it free at https://thinkroom.kieranklaassen.com” and set the
  homepage to `https://thinkroom.kieranklaassen.com`.
- [ ] Decide whether historical author email addresses may be public. If not,
  rewrite them before changing visibility and coordinate the required force
  push with every contributor.
- [ ] Enable private vulnerability reporting, Dependabot alerts, secret
  scanning, and push protection where the GitHub plan supports them.
- [ ] Protect `main`: require pull requests, required CI checks, resolved review
  conversations, and no force pushes or branch deletion.
- [ ] Confirm all production DNS records resolve and every configured hostname
  serves a valid TLS certificate.
- [ ] Confirm the production operator has an ignored `.kamal/deploy.env` with
  the existing service and storage-volume identifiers before the next deploy.
- [ ] Run `gitleaks git . --redact`, `bin/brakeman --no-pager`,
  `bin/bundler-audit`, and `npm audit --omit=dev` against the final history.
- [ ] Disable the wiki and any unused repository features, or populate them
  with intentional public content.
- [ ] Review the public repository from a logged-out browser before announcing
  it.
