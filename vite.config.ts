import react from '@vitejs/plugin-react'
import inertia from '@inertiajs/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import RubyPlugin from 'vite-plugin-ruby'

export default defineConfig(({ isSsrBuild }) => ({
  // Bundle every dependency into the production SSR output so the runtime
  // image can run `node public/vite-ssr/ssr.js` with only the node binary on
  // PATH — no node_modules ship in the final Docker stage. Scoped to the SSR
  // build (isSsrBuild) so the client build keeps Vite's default externals.
  ...(isSsrBuild ? { ssr: { noExternal: true } } : {}),
  plugins: [
    tailwindcss(),
    RubyPlugin(),
    // Our client entry lives outside the plugin's auto-detected SSR paths
    // (resources/js/*, src/*), so point it at the Inertia entry explicitly.
    // The path is resolved against Vite's root, which vite-plugin-ruby sets to
    // app/frontend (sourceCodeDir) — hence the root-relative entrypoints/…
    // rather than app/frontend/…. The plugin reuses this entry's
    // createInertiaApp for the SSR build and serves dev SSR through the Vite
    // dev server's /__inertia_ssr endpoint (no separate process). The
    // matching vite-plugin-ruby SSR entrypoint is configured in
    // config/vite.json (ssrEntrypoint), and `vite build --ssr` emits the
    // bundle to public/vite-ssr/ssr.js (vite-plugin-ruby keys the SSR input
    // as "ssr"); config.ssr_bundle in the initializer points there.
    inertia({ ssr: 'entrypoints/inertia.tsx' }),
    // The Inertia entry is excluded from react-refresh: the refresh footer
    // adds a timestamped self-import once the SSR warmup invalidates the
    // module node, so the entry executed TWICE per dev page load —
    // createInertiaApp booted the app a second time (hydrateRoot's
    // "container already passed to createRoot" warning, doubled boot work).
    // The entry defines no refreshable components and editing it falls back
    // to a full reload. node_modules stays excluded: a custom exclude
    // REPLACES the plugin's default rather than extending it.
    react({ exclude: [/\/node_modules\//, /entrypoints\/inertia\.tsx$/] }),
  ],
}))
