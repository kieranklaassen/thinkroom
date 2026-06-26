# Local development and review

- Run `bin/dev` for local development. It starts Rails and Vite together, so working-tree frontend changes are served without rebuilding production assets.
- Point Cloudflare review tunnels at the `bin/dev` Rails origin, not a production-mode preview server. Start an established port explicitly when needed (for example, `PORT=3001 bin/dev` for a tunnel already targeting 3001).
- Keep Vite Ruby's development `skipProxy` disabled. Rails must proxy `/vite-dev` through the same tunnel origin; direct `localhost:3036` asset URLs produce a white page for remote reviewers.
- Use `bin/vite build` only to verify a production build or prepare a production deployment, not for each tunnel iteration.

# Deploying

- Production runs on [Kamal](https://kamal-deploy.org/) (hosts: `thinkroom.kieranklaassen.com`, `pruf.kieranklaassen.com`). See `DEPLOYING.md` for first-time setup, secrets, and the complete deploy procedure.
- Always run Kamal with the Ruby version from `.ruby-version`, not macOS's system Ruby/Bundler: `export PATH="$HOME/.rbenv/versions/$(cat .ruby-version)/bin:$PATH"` before `bin/kamal` commands.
- Isolated worktrees do not inherit ignored deployment files. Before deploying from one, verify that `.kamal/deploy.env`, `.kamal/secrets`, and `config/master.key` exist and are non-empty; copy them from the primary checkout if needed without printing their contents.
- There is no auto-deploy on merge — deploys are run manually after merging to `main`.

# Documented knowledge

- `docs/solutions/` — documented solutions to past problems (bugs, best practices, architecture patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in a documented area.
- `docs/plans/` — implementation plans (`ce-plan` output); `CONCEPTS.md`, when present, holds shared domain vocabulary.

## Cursor Cloud specific instructions

- Ruby 3.4.2 is provided via `rbenv` (installed in `~/.rbenv`, initialized from `~/.bashrc`). Login/interactive shells get `ruby`/`bundle` on `PATH` automatically. If a non-login shell can't find `ruby`, run commands through `bash -lc '...'` or `eval "$(rbenv init - bash)"` first. Node 22 and `libvips` (image uploads) are already present.
- Dependencies refresh automatically on startup (the configured update script runs `bundle install` + `npm install`). The database is not reset by the update script — for a fresh checkout or to (re)create + seed the dev DB (`storage/development.sqlite3`, demo doc at `/d/demo`), run `bin/setup`.
- Run the app with `bin/dev` (see "Local development and review" above): Rails on `:3000`, Vite on `:3036`. Dev has no Redis/Postgres — Action Cable uses the in-process `async` adapter and storage is SQLite + local-disk Active Storage.
- Verify with `npm run check` (TypeScript), `bin/rubocop`, and `bin/rails test` (Minitest, ~405 tests). Google OAuth is optional (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`); anonymous and password flows work without it.
