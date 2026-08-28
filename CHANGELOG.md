# Changelog

Notable user-facing changes will be documented here. Thinkroom currently has
no stable release series; changes under development are listed as unreleased.

## Unreleased

- Added: WebMCP browser tools — Thinkroom pages register `thinkroom_*` tools
  (read, create, suggest, comment, resolve, presence, events) for agents
  driving a WebMCP-capable browser; writes are agent-attributed via
  `agent_name` and run at anonymous link-holder privilege. Set
  `WEBMCP_ORIGIN_TRIAL_TOKEN` to join the Chrome origin trial.
- Prepare the repository for public development with community health files,
  automated dependency auditing, write-rate limits, and a portable deployment
  configuration.
