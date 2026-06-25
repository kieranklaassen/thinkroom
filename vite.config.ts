import react from '@vitejs/plugin-react'
import inertia from '@inertiajs/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import RubyPlugin from 'vite-plugin-ruby'

export default defineConfig({
  plugins: [
    tailwindcss(),
    RubyPlugin(),
    // Our client entry lives outside the plugin's auto-detected SSR paths
    // (resources/js/*, src/*), so point it at the Inertia entry explicitly.
    // The path is resolved against Vite's root, which vite-plugin-ruby sets to
    // app/frontend (sourceCodeDir) — hence the root-relative entrypoints/…
    // rather than app/frontend/…. The plugin reuses this entry's
    // createInertiaApp for the SSR build and serves dev SSR through the Vite
    // dev server's /__inertia_ssr endpoint (no separate process).
    inertia({ ssr: 'entrypoints/inertia.tsx' }),
    react(),
  ],
})
