import { createInertiaApp } from '@inertiajs/react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { StrictMode, type ReactNode } from 'react'
import { RiffrecProvider } from 'riffrec'

// Every page mounts inside RiffrecProvider — the header's Feedback button
// records screen/voice/event sessions anywhere. RiffrecProvider renders a
// transparent passthrough on its first render (only Context.Provider, no DOM,
// overlays start null) and the SSR build resolves riffrec's Node export (a
// pure passthrough), so the server HTML and the client's first render are
// byte-identical — no hydration mismatch.
const Root = ({ children }: { children: ReactNode }) => (
  <StrictMode>
    <RiffrecProvider forceEnable>{children}</RiffrecProvider>
  </StrictMode>
)

void createInertiaApp({
  pages: "../pages",

  defaults: {
    form: {
      forceIndicesArrayFormatInFormData: false,
      withAllErrors: true,
    },
    visitOptions: () => {
      return { queryStringArrayFormat: "brackets" }
    },
  },

  // Custom setup: on the server (no `el`) return the tree for renderToString;
  // on the client hydrate the server-rendered HTML (or mount fresh for CSR
  // pages where SSR is disabled and no server markup exists).
  setup({ el, App, props }) {
    const tree = (
      <Root>
        <App {...props} />
      </Root>
    )
    // Server render: @inertiajs/react/server passes el: null and expects the
    // React element back to feed renderToString.
    if (!el) return tree
    if (el.dataset.serverRendered === "true") {
      hydrateRoot(el, tree)
    } else {
      createRoot(el).render(tree)
    }
  },
}).catch((error) => {
  // This ensures this entrypoint is only loaded on Inertia pages
  // by checking for the presence of the root element (#app by default).
  // Feel free to remove this `catch` if you don't need it.
  if (document.getElementById("app")) {
    throw error
  } else {
    console.error(
      "Missing root element.\n\n" +
      "If you see this error, it probably means you loaded Inertia.js on non-Inertia pages.\n" +
      'Consider moving <%= vite_typescript_tag "inertia.tsx" %> to the Inertia-specific layout instead.',
    )
  }
})
