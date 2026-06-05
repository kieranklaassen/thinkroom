---
name: inertia-rails-ssr
description: Set up Server-Side Rendering (SSR) for Inertia Rails applications. Use when you need SEO optimization, faster initial page loads, or support for users with JavaScript disabled.
license: MIT
metadata:
  author: community
  version: "2.0.0"
user-invocable: true
---

# Inertia Rails Server-Side Rendering (SSR)

Server-Side Rendering pre-renders JavaScript pages on the server, delivering fully rendered HTML to visitors. This improves SEO, enables faster initial page loads, and allows basic navigation even with JavaScript disabled.

## When to Use SSR

- **SEO-critical pages** - Landing pages, blog posts, product pages
- **Social sharing** - Pages that need proper Open Graph meta tags
- **Slow connections** - Users see content before JavaScript loads
- **Accessibility** - Basic functionality without JavaScript

## Requirements

- **Node.js** must be available on your server
- **Vite Ruby** for build configuration
- **`@inertiajs/vite`** plugin (recommended for v3)

## Recommended: Vite Plugin Setup (v3)

The `@inertiajs/vite` plugin simplifies SSR dramatically. In development, SSR runs through the Vite dev server automatically — no separate Node.js process needed.

### 1. Install the Vite Plugin

```bash
npm install @inertiajs/vite
```

### 2. Configure Vite

Update your `vite.config.js`:

**React:**
```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import inertia from '@inertiajs/vite'

export default defineConfig({
  plugins: [
    inertia(),
    react(),
  ],
})
```

**Vue 3:**
```javascript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import inertia from '@inertiajs/vite'

export default defineConfig({
  plugins: [
    inertia(),
    vue(),
  ],
})
```

**Svelte:**
```javascript
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import inertia from '@inertiajs/vite'

export default defineConfig({
  plugins: [
    inertia(),
    svelte(),
  ],
})
```

### 3. Update Entry Point for Hydration

The client entry point should use hydration instead of full rendering when SSR is enabled.

**React:**
```javascript
import { createInertiaApp } from '@inertiajs/react'
import { hydrateRoot } from 'react-dom/client'

createInertiaApp({
  resolve: (name) => {
    const pages = import.meta.glob('../pages/**/*.tsx', { eager: true })
    return pages[`../pages/${name}.tsx`]
  },
  setup({ el, App, props }) {
    hydrateRoot(el, <App {...props} />)
  },
})
```

**Vue 3:**
```javascript
import { createInertiaApp } from '@inertiajs/vue3'
import { createSSRApp, h } from 'vue'

createInertiaApp({
  resolve: (name) => {
    const pages = import.meta.glob('../pages/**/*.vue', { eager: true })
    return pages[`../pages/${name}.vue`]
  },
  setup({ el, App, props, plugin }) {
    createSSRApp({
      render: () => h(App, props),
    })
      .use(plugin)
      .mount(el)
  },
})
```

### 4. Enable SSR in Rails

```ruby
# config/initializers/inertia_rails.rb
InertiaRails.configure do |config|
  config.ssr_enabled = true

  # In development, SSR is handled by the Vite dev server automatically.
  # Set ssr_url to nil to auto-detect from Vite.
  config.ssr_url = nil

  # Optional: only enable SSR when the bundle exists (production)
  # config.ssr_bundle = Rails.root.join('public/vite-ssr/ssr.js')

  # Optional: cache SSR responses
  # config.ssr_cache = true
  # config.ssr_cache = { expires_in: 1.hour }

  # Optional: handle SSR errors gracefully
  config.ssr_raise_on_error = !Rails.env.production?
  config.on_ssr_error = ->(error, page) {
    Rails.logger.error "SSR error for #{page[:component]}: #{error.message}"
  }
end
```

### 5. Start Development

```bash
# Terminal 1: Rails server
bin/rails server

# Terminal 2: Vite dev server (handles SSR automatically)
bin/vite dev
```

That's it! No separate SSR server process needed in development.

## Manual SSR Setup (Without Vite Plugin)

If you can't use the Vite plugin, you can set up SSR manually with a separate entry point.

### 1. Create SSR Entry Point

Create `app/frontend/ssr/ssr.js`:

**Vue 3:**
```javascript
import { createInertiaApp } from '@inertiajs/vue3'
import createServer from '@inertiajs/vue3/server'
import { renderToString } from '@vue/server-renderer'
import { createSSRApp, h } from 'vue'

const pages = import.meta.glob('../pages/**/*.vue', { eager: true })

createServer((page) =>
  createInertiaApp({
    page,
    render: renderToString,
    resolve: (name) => {
      const page = pages[`../pages/${name}.vue`]
      if (!page) throw new Error(`Page not found: ${name}`)
      return page
    },
    setup({ App, props, plugin }) {
      return createSSRApp({
        render: () => h(App, props),
      }).use(plugin)
    },
  })
)
```

**React:**
```javascript
import { createInertiaApp } from '@inertiajs/react'
import createServer from '@inertiajs/react/server'
import ReactDOMServer from 'react-dom/server'

const pages = import.meta.glob('../pages/**/*.jsx', { eager: true })

createServer((page) =>
  createInertiaApp({
    page,
    render: ReactDOMServer.renderToString,
    resolve: (name) => {
      const page = pages[`../pages/${name}.jsx`]
      if (!page) throw new Error(`Page not found: ${name}`)
      return page
    },
    setup: ({ App, props }) => <App {...props} />,
  })
)
```

### 2. Configure Vite Ruby

Update `config/vite.json`:

```json
{
  "all": {
    "sourceCodeDir": "app/frontend",
    "entrypointsDir": "entrypoints"
  },
  "development": {
    "autoBuild": true
  },
  "production": {
    "ssrBuildEnabled": true
  }
}
```

### 3. Enable SSR in Rails

```ruby
InertiaRails.configure do |config|
  config.ssr_enabled = ViteRuby.config.ssr_build_enabled
  config.ssr_url = 'http://localhost:13714'
end
```

### 4. Build and Run

```bash
bin/vite build
bin/vite build --ssr
bin/vite ssr
```

## Production Deployment

In production, you still need to build the SSR bundle and run a Node.js server (even with the Vite plugin).

### Build for Production

```bash
bin/vite build
bin/vite build --ssr
```

### Process Manager (systemd)

Create `/etc/systemd/system/inertia-ssr.service`:

```ini
[Unit]
Description=Inertia SSR Server
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/var/www/myapp/current
ExecStart=/usr/bin/node public/vite-ssr/ssr.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable inertia-ssr
sudo systemctl start inertia-ssr
```

### Process Manager (PM2)

```bash
pm2 start public/vite-ssr/ssr.js --name inertia-ssr
pm2 save
```

### Docker

```dockerfile
CMD ["sh", "-c", "node public/vite-ssr/ssr.js & bundle exec puma"]
```

## Advanced Configuration

### SSR Response Caching

Cache SSR responses to reduce Node.js load:

```ruby
InertiaRails.configure do |config|
  # Simple boolean — uses default Rails cache store
  config.ssr_cache = true

  # Or with options
  config.ssr_cache = { expires_in: 1.hour }
end
```

### SSR Bundle Detection

Only attempt SSR when the bundle exists:

```ruby
InertiaRails.configure do |config|
  config.ssr_bundle = Rails.root.join('public/vite-ssr/ssr.js')
  # Can also be an array of paths to check
  # config.ssr_bundle = [
  #   Rails.root.join('public/vite-ssr/ssr.js'),
  #   Rails.root.join('public/vite-ssr/ssr.mjs'),
  # ]
end
```

### Clustering

For better performance on multi-core systems:

```javascript
// ssr/ssr.js
createServer(
  (page) => createInertiaApp({ /* ... */ }),
  { cluster: true }
)
```

### Custom Port

```javascript
createServer(
  (page) => createInertiaApp({ /* ... */ }),
  { port: 13715 }
)
```

### Conditional SSR

Enable SSR only for specific routes:

```ruby
class ApplicationController < ActionController::Base
  # Disable SSR for admin pages
  inertia_config(ssr_enabled: false)
end

class PagesController < ApplicationController
  # Enable SSR for public pages
  inertia_config(ssr_enabled: Rails.env.production?)
end

# Per-action with a lambda
class PostsController < ApplicationController
  inertia_config(ssr_enabled: ->(request) {
    request.path.start_with?('/blog')
  })
end
```

## Title and Meta Tags

### Server-Managed Meta Tags (v3)

Set meta tags from your controller using the `inertia_meta` helper or the `meta:` render option:

```ruby
class PostsController < ApplicationController
  def show
    post = Post.find(params[:id])

    render inertia: {
      post: post.as_json(only: [:id, :title, :content])
    }, meta: {
      title: post.title,
      description: post.excerpt,
      og_image: post.cover_image_url
    }
  end
end
```

### Using Head Component

**Vue 3:**
```vue
<script setup>
import { Head } from '@inertiajs/vue3'

defineProps(['post'])
</script>

<template>
  <Head>
    <title>{{ post.title }}</title>
    <meta name="description" :content="post.excerpt" />
    <meta property="og:title" :content="post.title" />
    <meta property="og:image" :content="post.coverImageUrl" />
  </Head>

  <article>
    <h1>{{ post.title }}</h1>
  </article>
</template>
```

**React:**
```jsx
import { Head } from '@inertiajs/react'

export default function Show({ post }) {
  return (
    <>
      <Head>
        <title>{post.title}</title>
        <meta name="description" content={post.excerpt} />
        <meta property="og:title" content={post.title} />
      </Head>

      <article>
        <h1>{post.title}</h1>
      </article>
    </>
  )
}
```

### Default Title Template

```javascript
createInertiaApp({
  title: (title) => title ? `${title} - My App` : 'My App',
  // ...
})
```

## Troubleshooting

### SSR Server Not Responding

1. Check if the SSR server is running: `curl http://localhost:13714`
2. Check logs: `journalctl -u inertia-ssr -f`
3. Verify the port matches your Rails config
4. If using the Vite plugin in dev, ensure the Vite dev server is running

### Hydration Mismatch Errors

1. Ensure client and server render the same content
2. Avoid browser-only APIs in initial render (use `onMounted`/`useEffect`)
3. Check for date/time formatting differences

```javascript
// Bad - different on server vs client
const time = new Date().toLocaleTimeString()

// Good - render after mount
const time = ref(null)
onMounted(() => {
  time.value = new Date().toLocaleTimeString()
})
```

### Memory Leaks

1. Avoid global state mutations in SSR
2. Use request-scoped state only
3. Monitor Node.js memory usage

### SSR Fails Silently

Configure error handling to catch and log SSR failures:

```ruby
InertiaRails.configure do |config|
  config.ssr_raise_on_error = !Rails.env.production?
  config.on_ssr_error = ->(error, page) {
    Rails.logger.error "SSR error: #{error.message}"
    Sentry.capture_exception(error) if defined?(Sentry)
  }
end
```

## Performance Tips

1. **Keep SSR lightweight** - Defer heavy computations to client
2. **Use caching** - Enable `ssr_cache` for static/semi-static pages
3. **Use clustering** - Enable multi-worker mode for production
4. **Monitor latency** - Track SSR render times
5. **Bundle detection** - Use `ssr_bundle` to gracefully fall back to CSR

```ruby
# Log slow SSR renders
around_action :track_ssr_time, if: -> { request.inertia? }

def track_ssr_time
  start = Time.current
  yield
  duration = Time.current - start
  Rails.logger.info "SSR render: #{duration.round(3)}s" if duration > 0.1
end
```
