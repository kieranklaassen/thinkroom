# Local development and review

- Run `bin/dev` for local development. It starts Rails and Vite together, so working-tree frontend changes are served without rebuilding production assets.
- Point Cloudflare review tunnels at the `bin/dev` Rails origin, not a production-mode preview server. Start an established port explicitly when needed (for example, `PORT=3001 bin/dev` for a tunnel already targeting 3001).
- Keep Vite Ruby's development `skipProxy` disabled. Rails must proxy `/vite-dev` through the same tunnel origin; direct `localhost:3036` asset URLs produce a white page for remote reviewers.
- Use `bin/vite build` only to verify a production build or prepare a production deployment, not for each tunnel iteration.

# Deploying

- Production runs on [Kamal](https://kamal-deploy.org/) (hosts: `thinkroom.kieranklaassen.com`, `pruf.kieranklaassen.com`). Deploy with `set -a; source .kamal/deploy.env; set +a; bin/kamal deploy`. See `DEPLOYING.md` for first-time setup and secrets.
- There is no auto-deploy on merge — deploys are run manually after merging to `main`.

# Documented knowledge

- `docs/solutions/` — documented solutions to past problems (bugs, best practices, architecture patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in a documented area.
- `docs/plans/` — implementation plans (`ce-plan` output); `CONCEPTS.md`, when present, holds shared domain vocabulary.
