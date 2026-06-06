import { createInertiaApp } from '@inertiajs/react'
import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import { RiffrecProvider } from 'riffrec'

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

  // Custom setup so every page mounts inside RiffrecProvider — the
  // header's Feedback button records screen/voice/event sessions anywhere.
  setup({ el, App, props }) {
    if (!el) return
    createRoot(el).render(
      <StrictMode>
        <RiffrecProvider forceEnable>
          <App {...props} />
        </RiffrecProvider>
      </StrictMode>,
    )
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
