# Local development and review

- Run `bin/dev` for local development. It starts Rails and Vite together, so working-tree frontend changes are served without rebuilding production assets.
- Point Cloudflare review tunnels at the `bin/dev` Rails origin, not a production-mode preview server. Start an established port explicitly when needed (for example, `PORT=3001 bin/dev` for a tunnel already targeting 3001).
- Keep Vite Ruby's development `skipProxy` disabled. Rails must proxy `/vite-dev` through the same tunnel origin; direct `localhost:3036` asset URLs produce a white page for remote reviewers.
- Use `bin/vite build` only to verify a production build or prepare a production deployment, not for each tunnel iteration.
