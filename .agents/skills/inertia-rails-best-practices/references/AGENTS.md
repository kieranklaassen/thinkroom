# Inertia Rails Best Practices - Complete Reference

This document contains detailed explanations, code examples, and implementation guidance for all Inertia Rails best practices.

---

## 1. Server-Side Setup & Configuration (CRITICAL)

These rules establish the foundation for all Inertia functionality. Proper setup ensures reliable operation and maintainability.

---

### setup-01: Use the Rails generator for initial setup

**Impact:** CRITICAL - Ensures correct configuration and avoids common setup errors

**Problem:** Manual setup can miss important configuration steps, leading to subtle bugs.

**Solution:** Use the built-in Rails generator for consistent setup:

```bash
# Add the gem
bundle add inertia_rails

# Run the generator
bin/rails generate inertia:install
```

The generator handles:
- Vite Rails detection and installation
- TypeScript configuration
- Frontend framework selection (React, Vue, or Svelte)
- Tailwind CSS integration (optional)
- Example controller and view files
- Application configuration

**When manual setup is needed:**

```erb
<!-- app/views/layouts/application.html.erb -->
<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <%= csp_meta_tag %>
    <%= inertia_ssr_head %>
    <%= vite_client_tag %>
    <%= vite_javascript_tag 'application' %>
  </head>
  <body>
    <%= yield %>
  </body>
</html>
```

---

### setup-02: Configure asset versioning for cache busting

**Impact:** CRITICAL - Ensures users receive updated assets after deployments

**Problem:** Without version tracking, users may see stale JavaScript after deployments.

**Solution:** Configure version in your initializer:

```ruby
# config/initializers/inertia_rails.rb
InertiaRails.configure do |config|
  # Using ViteRuby digest (recommended)
  config.version = -> { ViteRuby.digest }

  # Or using a custom version string
  # config.version = Rails.application.config.assets_version

  # Or using Git commit hash
  # config.version = -> { `git rev-parse HEAD`.strip }
end
```

**How it works:** When the version changes, Inertia triggers a full page visit instead of an XHR request, ensuring fresh assets are loaded.

---

### setup-03: Set up proper layout inheritance

**Impact:** HIGH - Enables flexible layout management across controllers

**Problem:** All Inertia pages using the same layout limits design flexibility.

**Solution:** Configure default layout and override per-controller:

```ruby
# config/initializers/inertia_rails.rb
InertiaRails.configure do |config|
  config.layout = 'application'  # default
end

# app/controllers/admin/base_controller.rb
class Admin::BaseController < ApplicationController
  layout 'admin'
end

# Or use inertia_config for controller-specific settings
class MarketingController < ApplicationController
  inertia_config(layout: 'marketing')
end
```

---

### setup-04: Configure flash keys appropriately

**Impact:** MEDIUM - Ensures proper flash message delivery to frontend

**Problem:** Custom flash keys may not be passed to the frontend by default.

**Solution:** Configure allowed flash keys:

```ruby
# config/initializers/inertia_rails.rb
InertiaRails.configure do |config|
  # Default: %i[notice alert]
  config.flash_keys = %i[notice alert success error warning info]
end
```

For custom flash data beyond allowlisted keys:

```ruby
# Controller
flash.inertia[:custom_data] = { message: 'Success!', type: 'toast' }

# Or for current request only
flash.inertia.now[:custom_data] = { message: 'Success!' }
```

---

### setup-05: Use environment variables for configuration

**Impact:** MEDIUM - Enables deployment flexibility without code changes

**Problem:** Hardcoded configuration limits deployment options.

**Solution:** Inertia Rails supports `INERTIA_` prefixed environment variables:

```bash
# .env or deployment config
INERTIA_SSR_ENABLED=true
INERTIA_SSR_URL=http://localhost:13714
INERTIA_ENCRYPT_HISTORY=true
INERTIA_DEEP_MERGE_SHARED_DATA=true
```

Boolean values must be exactly `"true"` or `"false"` (case-sensitive).

---

### setup-06: Set up default render behavior thoughtfully

**Impact:** MEDIUM - Reduces boilerplate while maintaining explicitness

**Problem:** Overly implicit rendering can make code harder to understand.

```ruby
# config/initializers/inertia_rails.rb
InertiaRails.configure do |config|
  # Enable convention-based rendering
  config.default_render = true

  # Customize component path resolution
  config.component_path_resolver = ->(path:, action:) do
    "#{path.camelize}/#{action.camelize}"
  end
end
```

**Incorrect - implicit rendering without clear conventions:**
```ruby
class UsersController < ApplicationController
  def show
    @user = User.find(params[:id])
    # What component gets rendered? Unclear.
  end
end
```

**Correct - explicit rendering:**
```ruby
class UsersController < ApplicationController
  def show
    user = User.find(params[:id])
    render inertia: { user: user.as_json(only: [:id, :name, :email]) }
  end
end
```

---

## 2. Props & Data Management (CRITICAL)

Proper props management is crucial for performance and security. These rules can provide 2-5× performance improvements.

---

### props-01: Return only necessary data in props

**Impact:** CRITICAL - Reduces payload size, improves security, prevents data leaks

**Problem:** Returning entire ActiveRecord objects exposes unnecessary data and bloats responses.

**Incorrect:**
```ruby
def show
  render inertia: { user: User.find(params[:id]) }
  # Exposes all columns including password_digest, tokens, etc.
end
```

**Correct:**
```ruby
def show
  user = User.find(params[:id])
  render inertia: {
    user: user.as_json(only: [:id, :name, :email, :avatar_url])
  }
end

# Or with associations
def show
  user = User.find(params[:id])
  render inertia: {
    user: user.as_json(
      only: [:id, :name, :email],
      include: {
        posts: { only: [:id, :title, :published_at] }
      }
    )
  }
end
```

**Note:** Some browsers limit history state size (Firefox: 16 MiB). Keep props minimal.

---

### props-02: Use shared data for global props

**Impact:** HIGH - Reduces duplication, centralizes common data

**Problem:** Repeating the same props in every controller action.

**Incorrect:**
```ruby
class UsersController < ApplicationController
  def index
    render inertia: {
      current_user: current_user.as_json(only: [:id, :name]),
      app_name: Rails.configuration.app_name,
      users: User.all
    }
  end

  def show
    render inertia: {
      current_user: current_user.as_json(only: [:id, :name]),
      app_name: Rails.configuration.app_name,
      user: User.find(params[:id])
    }
  end
end
```

**Correct:**
```ruby
# app/controllers/application_controller.rb
class ApplicationController < ActionController::Base
  # Static data - evaluated once
  inertia_share app_name: Rails.configuration.app_name

  # Dynamic data - evaluated per request
  inertia_share do
    if user_signed_in?
      {
        auth: {
          user: current_user.as_json(only: [:id, :name, :email, :avatar_url])
        }
      }
    else
      { auth: { user: nil } }
    end
  end

  # Lambda for lazy evaluation
  inertia_share notifications_count: -> { current_user&.unread_notifications_count }
end

# Controller only needs page-specific data
class UsersController < ApplicationController
  def index
    render inertia: { users: User.all.as_json(only: [:id, :name]) }
  end
end
```

---

### props-03: Leverage lazy evaluation with lambdas

**Impact:** HIGH - Prevents unnecessary database queries

**Problem:** Eagerly evaluated props execute even when not needed.

**Incorrect:**
```ruby
inertia_share do
  {
    # This query runs on EVERY request, even if not used
    recent_posts: Post.recent.limit(5).as_json
  }
end
```

**Correct:**
```ruby
inertia_share do
  {
    # Only evaluated when actually accessed
    recent_posts: -> { Post.recent.limit(5).as_json }
  }
end
```

---

### props-04: Use deferred props for non-critical data

**Impact:** HIGH - Improves perceived performance by loading page faster

**Problem:** Expensive data queries block initial page render.

**Incorrect:**
```ruby
def dashboard
  render inertia: {
    user: current_user,
    # These block initial render
    analytics: Analytics.expensive_query,
    recommendations: Recommendations.compute_for(current_user)
  }
end
```

**Correct:**
```ruby
def dashboard
  render inertia: {
    user: current_user.as_json(only: [:id, :name]),
    # Loaded after initial render
    analytics: InertiaRails.defer { Analytics.expensive_query },
    # Group related deferred props
    recommendations: InertiaRails.defer(group: 'suggestions') {
      Recommendations.compute_for(current_user)
    },
    similar_users: InertiaRails.defer(group: 'suggestions') {
      User.similar_to(current_user)
    }
  }
end
```

**Frontend handling:**
```vue
<template>
  <div>
    <h1>Welcome, {{ user.name }}</h1>

    <Deferred data="analytics">
      <template #fallback>
        <AnalyticsSkeleton />
      </template>
      <AnalyticsChart :data="analytics" />
    </Deferred>
  </div>
</template>
```

---

### props-05: Implement partial reloads correctly

**Impact:** MEDIUM-HIGH - Reduces data transfer on page refreshes

**Problem:** Reloading entire page data when only some props changed.

**Incorrect:**
```javascript
// Reloads all props
router.reload()
```

**Correct:**
```javascript
// Only reload specific props
router.reload({ only: ['users'] })

// Exclude specific props
router.reload({ except: ['analytics'] })

// In Link component
<Link href="/users" :only="['users']">Refresh Users</Link>
```

**Server-side optimization:**
```ruby
def index
  render inertia: {
    # Always included
    users: User.all.as_json(only: [:id, :name]),

    # Only included when explicitly requested
    statistics: InertiaRails.optional { compute_statistics },

    # Always included, even in partial reloads
    csrf_token: InertiaRails.always { form_authenticity_token }
  }
end
```

---

### props-06: Never expose sensitive data in props

**Impact:** CRITICAL - Security vulnerability prevention

**Problem:** Props are visible in browser DevTools and can be cached in history.

**Incorrect:**
```ruby
def show
  render inertia: {
    user: User.find(params[:id])
    # Exposes: password_digest, reset_token, api_keys, etc.
  }
end
```

**Correct:**
```ruby
def show
  user = User.find(params[:id])
  render inertia: {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      # Only public attributes
    }
  }
end

# Or use a serializer/presenter
def show
  user = User.find(params[:id])
  render inertia: { user: UserPresenter.new(user).as_json }
end
```

---

### props-07: Use proper serialization with as_json

**Impact:** MEDIUM - Consistent data formatting, prevents accidental exposure

**Correct patterns:**
```ruby
# Simple whitelist
user.as_json(only: [:id, :name, :email])

# With associations
user.as_json(
  only: [:id, :name],
  include: {
    posts: { only: [:id, :title] },
    profile: { only: [:bio, :avatar_url] }
  }
)

# With computed methods
user.as_json(
  only: [:id, :name],
  methods: [:full_name, :avatar_url]
)

# Exclude specific fields
user.as_json(except: [:password_digest, :remember_token])
```

---

### props-08: Implement deep merge when appropriate

**Impact:** MEDIUM - Proper handling of nested shared data

**Problem:** Shallow merge overwrites nested objects unexpectedly.

```ruby
# config/initializers/inertia_rails.rb
InertiaRails.configure do |config|
  config.deep_merge_shared_data = true
end

# Or per-request
render inertia: { nested: { key: 'value' } }, deep_merge: true
```

---

### props-09: Use once props for stable data

**Impact:** MEDIUM - Reduces redundant data transfer

**Problem:** Stable data resent on every navigation.

**Correct:**
```ruby
# Resolved once and remembered across navigations
inertia_share do
  {
    app_config: InertiaRails.once { AppConfig.to_json },
    feature_flags: InertiaRails.once { FeatureFlags.for_user(current_user) }
  }
end
```

---

## 3. Forms & Validation (HIGH)

Forms are central to most applications. These patterns ensure good user experience and data integrity.

---

### forms-01: Use useForm helper for complex forms

**Impact:** HIGH - Provides state management, validation, and submission handling

**Problem:** Managing form state manually is error-prone and verbose.

**Correct (React):**
```jsx
import { useForm } from '@inertiajs/react'

export default function CreateUser() {
  const { data, setData, post, processing, errors, progress, reset } = useForm({
    name: '',
    email: '',
    password: '',
    avatar: null,
  })

  function submit(e) {
    e.preventDefault()
    post('/users', {
      onSuccess: () => reset('password'),
      preserveScroll: true,
    })
  }

  return (
    <form onSubmit={submit}>
      <input type="text" value={data.name} onChange={e => setData('name', e.target.value)} />
      {errors.name && <div className="error">{errors.name}</div>}

      <input type="email" value={data.email} onChange={e => setData('email', e.target.value)} />
      {errors.email && <div className="error">{errors.email}</div>}

      <input type="password" value={data.password} onChange={e => setData('password', e.target.value)} />

      <input type="file" onChange={e => setData('avatar', e.target.files[0])} />
      {progress && <progress value={progress.percentage} max="100" />}

      <button type="submit" disabled={processing}>
        {processing ? 'Saving...' : 'Save'}
      </button>
    </form>
  )
}
```

**Key useForm features:**
- `form.processing` - Prevents double submission
- `form.progress` - File upload progress
- `form.errors` - Validation errors from server
- `form.isDirty` - Detects unsaved changes
- `form.reset()` - Reset specific or all fields
- `form.clearErrors()` - Clear validation errors

---

### forms-02: Use Form component for simple forms

**Impact:** MEDIUM - Declarative syntax for straightforward forms

```jsx
import { Form } from '@inertiajs/react'

export default function CreateUser() {
  return (
    <Form action="/users" method="post">
      {({ errors, processing }) => (
        <>
          <input type="text" name="name" />
          {errors.name && <div>{errors.name}</div>}
          <input type="email" name="email" />
          <button type="submit" disabled={processing}>Submit</button>
        </>
      )}
    </Form>
  )
}
```

---

### forms-03: Handle validation errors properly

**Impact:** HIGH - Clear user feedback on validation failures

**Server-side:**
```ruby
class UsersController < ApplicationController
  def create
    user = User.new(user_params)

    if user.save
      redirect_to users_url, notice: 'User created successfully'
    else
      redirect_to new_user_url, inertia: { errors: user.errors }
    end
  end
end
```

**Client-side:**
```jsx
<div>
  <input type="email" value={data.email} onChange={e => setData('email', e.target.value)} />
  {errors.email && <span className="text-red-500">{errors.email}</span>}
</div>
```

---

### forms-04: Implement error bags for multiple forms

**Impact:** MEDIUM - Prevents error collision on pages with multiple forms

**Problem:** Two forms with same field names share error states.

**Solution:**
```javascript
// Form 1 - Create user
const createForm = useForm({ email: '' })
createForm.post('/users', { errorBag: 'createUser' })

// Form 2 - Invite user
const inviteForm = useForm({ email: '' })
inviteForm.post('/invitations', { errorBag: 'inviteUser' })
```

Access errors at `page.props.errors.createUser` and `page.props.errors.inviteUser`.

---

### forms-05: Use redirect pattern after form submission

**Impact:** HIGH - Follows PRG pattern, prevents duplicate submissions

**Incorrect:**
```ruby
def create
  @user = User.create(user_params)
  render inertia: { user: @user }  # Can cause duplicate on refresh
end
```

**Correct:**
```ruby
def create
  user = User.new(user_params)

  if user.save
    redirect_to user_url(user), notice: 'User created!'
  else
    redirect_to new_user_url, inertia: { errors: user.errors }
  end
end
```

---

### forms-06: Handle file uploads correctly

**Impact:** MEDIUM - Proper multipart form handling

```ruby
# Controller
def create
  user = User.new(user_params)
  user.avatar.attach(params[:avatar]) if params[:avatar]
  # ...
end
```

```jsx
const { data, setData, post, progress } = useForm({
  name: '',
  avatar: null,
})

function submit(e) {
  e.preventDefault()
  post('/users')  // Automatically uses FormData when files present
}

return (
  <form onSubmit={submit}>
    <input type="file" onChange={e => setData('avatar', e.target.files[0])} />
    {progress && (
      <progress value={progress.percentage} max="100">
        {progress.percentage}%
      </progress>
    )}
  </form>
)
```

**For PUT/PATCH with files (method spoofing):**
```javascript
form.post(`/users/${user.id}`, {
  _method: 'put',  // Rails handles this via Rack::MethodOverride
})
```

---

### forms-07: Preserve form state on validation errors

**Impact:** HIGH - Users don't lose their input on errors

Inertia automatically preserves component state for POST, PUT, PATCH, DELETE requests. The form data persists; you only need to display errors.

```ruby
# Server - redirect back with errors
def create
  user = User.new(user_params)
  unless user.save
    redirect_to new_user_url, inertia: { errors: user.errors }
  end
end
```

---

### forms-08: Use dotted notation for nested data

**Impact:** MEDIUM - Clean handling of complex form structures

```jsx
<Form action="/reports" method="post">
  {({ errors }) => (
    <>
      <input type="text" name="report.title" />
      <textarea name="report.description" />
      <input type="text" name="report.metadata.author" />
    </>
  )}
</Form>
```

Access errors with dotted notation: `errors['report.title']`

---

## 4. Navigation & Routing (HIGH)

Navigation patterns that maintain the SPA experience while leveraging server-side routing.

---

### nav-01: Use Link component for internal navigation

**Impact:** HIGH - Maintains SPA behavior without full page reloads

**Incorrect:**
```jsx
<a href="/users">Users</a>  {/* Full page reload */}
```

**Correct:**
```jsx
import { Link } from '@inertiajs/react'

<Link href="/users">Users</Link>

{/* With additional options */}
<Link
  href="/users"
  method="post"
  data={{ active: true }}
  preserveScroll
  preserveState
>
  Filter Active Users
</Link>
```

---

### nav-02: Use inertia_location for external redirects

**Impact:** MEDIUM - Proper handling of non-Inertia URLs

**Problem:** Standard redirects to external URLs fail in XHR context.

**Solution:**
```ruby
def redirect_to_external
  inertia_location 'https://example.com'
end

# Also works for non-Inertia internal pages
def download_report
  inertia_location reports_download_path(format: :pdf)
end
```

This returns a 409 response with `X-Inertia-Location` header, triggering `window.location` navigation.

---

### nav-03: Implement preserve-scroll appropriately

**Impact:** MEDIUM - Better user experience during navigation

```jsx
{/* Always preserve scroll */}
<Link href="/users" preserveScroll>Users</Link>

{/* Preserve only when there are errors */}
form.post('/users', {
  preserveScroll: 'errors'
})

{/* Conditional preservation */}
form.post('/users', {
  preserveScroll: (page) => page.props.shouldPreserve
})
```

---

### nav-04: Use preserve-state for component state

**Impact:** MEDIUM - Maintains local component state during navigation

```jsx
<Link href="/users?search=john" preserveState>
  Search
</Link>
```

Useful for:
- Search filters
- Tab selections
- Expanded/collapsed states
- Form inputs during validation

---

### nav-05: Configure proper HTTP methods on links

**Impact:** HIGH - RESTful actions and proper server handling

```jsx
{/* DELETE request */}
<Link
  href="/users/1"
  method="delete"
  as="button"
>
  Delete User
</Link>

{/* POST request with data */}
<Link
  href="/posts/1/publish"
  method="post"
  data={{ published_at: new Date() }}
  as="button"
>
  Publish
</Link>
```

**Note:** Use `as="button"` for non-GET methods to prevent right-click "open in new tab" issues.

---

### nav-06: Use the inertia route helper for static pages

**Impact:** LOW - Cleaner routes for pages without controller logic

```ruby
# config/routes.rb
Rails.application.routes.draw do
  # Maps /about to About component
  inertia 'about' => 'About'

  # Custom path
  inertia 'faq' => 'Help/FAQ'

  # Using just the path (component inferred)
  inertia :privacy
  inertia :terms

  # Within namespaces
  namespace :admin do
    inertia :dashboard
  end
end
```

---

### nav-07: Handle 303 redirects correctly

**Impact:** MEDIUM - Proper redirect behavior after form submissions

The Rails adapter automatically converts redirects to 303 status after PUT, PATCH, DELETE requests. This ensures the follow-up request uses GET method.

```ruby
def update
  user.update(user_params)
  redirect_to user_url(user)  # Automatically 303 for PUT/PATCH
end

def destroy
  user.destroy
  redirect_to users_url  # Automatically 303 for DELETE
end
```

---

## 5. Performance Optimization (MEDIUM-HIGH)

These optimizations can improve page load times by 30-70%.

---

### perf-01: Implement code splitting with dynamic imports

**Impact:** HIGH - Reduces initial bundle size significantly

**Incorrect (eager loading):**
```javascript
// All pages loaded upfront
const pages = import.meta.glob('../pages/**/*.vue', { eager: true })

createInertiaApp({
  resolve: (name) => pages[`../pages/${name}.vue`],
})
```

**Correct (lazy loading):**
```javascript
// Pages loaded on demand
const pages = import.meta.glob('../pages/**/*.vue')

createInertiaApp({
  resolve: (name) => pages[`../pages/${name}.vue`](),  // Note the ()
})
```

**Note:** Code splitting adds extra requests. For small applications, a single bundle may perform better.

---

### perf-02: Use prefetching for likely navigation

**Impact:** MEDIUM-HIGH - Perceived instant navigation

```jsx
{/* Prefetch on hover (default) */}
<Link href="/users" prefetch>Users</Link>

{/* Prefetch on mount (for very likely navigation) */}
<Link href="/dashboard" prefetch="mount">Dashboard</Link>

{/* Prefetch on click (mousedown) */}
<Link href="/reports" prefetch="click">Reports</Link>

{/* Custom cache duration */}
<Link href="/users" prefetch cacheFor="1m">Users</Link>

{/* Programmatic prefetching */}
import { router } from '@inertiajs/react'
import { useEffect } from 'react'

useEffect(() => {
  router.prefetch('/likely-next-page')
}, [])
```

---

### perf-03: Configure stale-while-revalidate caching

**Impact:** MEDIUM - Balance between freshness and speed

```jsx
{/* Serve cached for 30s, then revalidate in background for up to 1m */}
<Link href="/users" prefetch cacheFor={['30s', '1m']}>
  Users
</Link>
```

---

### perf-04: Use polling only when necessary

**Impact:** MEDIUM - Real-time updates without WebSockets

```jsx
import { usePoll } from '@inertiajs/react'

// Poll every 5 seconds
usePoll(5000)

// With options
usePoll(5000, {
  only: ['notifications'],
  onStart: () => console.log('Polling...'),
})

// Manual control
const { start, stop } = usePoll(5000, {}, { autoStart: false })

// Throttle in background tabs (default: 90%)
usePoll(5000, {}, { keepAlive: false })
```

---

### perf-05: Implement infinite scrolling with merge props

**Impact:** MEDIUM - Smooth loading of large datasets

**Server-side:**
```ruby
def index
  posts = Post.page(params[:page]).per(20)

  render inertia: {
    posts: InertiaRails.merge { posts.as_json },
    pagination: {
      current_page: posts.current_page,
      total_pages: posts.total_pages
    }
  }
end
```

**Client-side:**
```vue
<script setup>
import { router } from '@inertiajs/vue3'

const props = defineProps(['posts', 'pagination'])

function loadMore() {
  router.reload({
    data: { page: props.pagination.current_page + 1 },
    only: ['posts', 'pagination'],
    preserveScroll: true,
  })
}
</script>
```

---

### perf-06: Optimize progress indicators

**Impact:** LOW - Better perceived performance

```javascript
createInertiaApp({
  progress: {
    delay: 250,        // Don't show for quick requests
    color: '#29d',     // Brand color
    includeCSS: true,  // Use built-in styles
    showProgress: true // Show percentage
  },
})

// Disable for specific requests
router.visit('/quick-action', { showProgress: false })
```

---

### perf-07: Use async visits for non-blocking operations

**Impact:** MEDIUM - Parallel operations without blocking UI

```javascript
// Background request that doesn't show loading state
router.post('/analytics/track', { event: 'page_view' }, {
  async: true,
  showProgress: false
})
```

---

## 6. Security (MEDIUM-HIGH)

Security patterns specific to Inertia Rails applications.

---

### sec-01: Implement authentication server-side

**Impact:** CRITICAL - Proper auth doesn't require special handling

Inertia works with any Rails authentication system:

```ruby
# Works with Devise
class ApplicationController < ActionController::Base
  before_action :authenticate_user!

  inertia_share do
    {
      auth: {
        user: current_user&.as_json(only: [:id, :name, :email])
      }
    }
  end
end

# Works with has_secure_password
class SessionsController < ApplicationController
  def create
    user = User.find_by(email: params[:email])
    if user&.authenticate(params[:password])
      session[:user_id] = user.id
      redirect_to dashboard_url
    else
      redirect_to login_url, inertia: { errors: { email: 'Invalid credentials' } }
    end
  end
end
```

---

### sec-02: Pass authorization results as props

**Impact:** HIGH - Frontend can't access server-side auth helpers

**Incorrect:**
```vue
<!-- Can't check policies in frontend -->
<button v-if="can(:edit, user)">Edit</button>
```

**Correct - pass permissions as props:**
```ruby
# Controller
def index
  render inertia: {
    can: {
      create_user: allowed_to?(:create, User)
    },
    users: User.all.map do |user|
      user.as_json(only: [:id, :name]).merge(
        can: {
          edit: allowed_to?(:edit, user),
          delete: allowed_to?(:delete, user)
        }
      )
    end
  }
end
```

```jsx
{can.create_user && <button>Create User</button>}

{users.map(user => (
  <div key={user.id}>
    {user.name}
    {user.can.edit && <button>Edit</button>}
    {user.can.delete && <button>Delete</button>}
  </div>
))}
```

---

### sec-03: Use history encryption for sensitive data

**Impact:** MEDIUM - Prevents back button data exposure after logout

```ruby
# config/initializers/inertia_rails.rb
InertiaRails.configure do |config|
  config.encrypt_history = true
end

# Or per-controller
class Admin::BaseController < ApplicationController
  inertia_config(encrypt_history: true)
end

# Or per-request
render inertia: { sensitive_data: data }, encrypt_history: true
```

**Clear history on logout:**
```ruby
def destroy
  reset_session
  render inertia: {}, clear_history: true
  redirect_to root_url
end
```

---

### sec-04: Rely on Rails CSRF protection

**Impact:** CRITICAL - Automatic protection, no extra config needed

Inertia automatically handles CSRF by:
1. Reading the `XSRF-TOKEN` cookie set by Rails
2. Sending the `X-XSRF-TOKEN` header with requests

Note: In Inertia.js v3, Axios was replaced with a built-in HTTP client. CSRF handling works the same way.

**Ensure Rails sets the cookie:**
```ruby
# application_controller.rb
class ApplicationController < ActionController::Base
  # Included by default in Rails
  protect_from_forgery with: :exception
end
```

---

### sec-05: Validate and sanitize all input server-side

**Impact:** CRITICAL - Never trust client-side validation alone

```ruby
class UsersController < ApplicationController
  def create
    user = User.new(user_params)

    # Server-side validation
    if user.save
      redirect_to users_url
    else
      redirect_to new_user_url, inertia: { errors: user.errors }
    end
  end

  private

  def user_params
    params.require(:user).permit(:name, :email, :password)
  end
end
```

---

### sec-06: Use strong parameters in controllers

**Impact:** CRITICAL - Prevents mass assignment vulnerabilities

```ruby
private

def user_params
  params.require(:user).permit(
    :name,
    :email,
    :password,
    :password_confirmation,
    profile_attributes: [:bio, :website]
  )
end
```

---

## 7. Testing (MEDIUM)

Testing patterns for Inertia Rails applications.

---

### test-01: Use RSpec matchers for Inertia responses

**Impact:** HIGH - Comprehensive response testing

```ruby
# spec/rails_helper.rb
require 'inertia_rails/rspec'

# spec/requests/users_spec.rb
RSpec.describe '/users' do
  describe 'GET /users' do
    it 'renders the index component' do
      get users_path

      expect(inertia).to be_inertia_response
      expect(inertia).to render_component('users/index')
      expect(inertia).to have_props(users: be_an(Array))
    end
  end

  describe 'GET /users/:id' do
    let(:user) { create(:user, name: 'John') }

    it 'renders user data' do
      get user_path(user)

      expect(inertia).to have_props(
        user: hash_including(
          id: user.id,
          name: 'John'
        )
      )
    end
  end

  describe 'POST /users' do
    context 'with invalid params' do
      it 'returns validation errors' do
        post users_path, params: { user: { name: '' } }
        follow_redirect!

        expect(inertia).to have_props(
          errors: hash_including(:name)
        )
      end
    end
  end
end
```

---

### test-02: Use Minitest assertions for Inertia

**Impact:** HIGH - Testing with Rails default framework

```ruby
# test/test_helper.rb
require 'inertia_rails/minitest'

# test/integration/users_test.rb
class UsersTest < ActionDispatch::IntegrationTest
  test 'renders users index' do
    get users_path

    assert_inertia_response
    assert_inertia_component 'users/index'
    assert_inertia_props title: 'All Users'
  end

  test 'shows validation errors' do
    post users_path, params: { user: { name: '' } }
    follow_redirect!

    assert_inertia_props errors: { name: ["can't be blank"] }
  end
end
```

---

### test-03: Test partial reloads and deferred props

**Impact:** MEDIUM - Testing advanced features

```ruby
RSpec.describe '/dashboard' do
  it 'supports partial reloads' do
    get dashboard_path
    expect(inertia).to have_props(:users, :stats)

    # Simulate partial reload
    inertia_reload_only(:users)
    expect(inertia).to have_props(:users)
    expect(inertia).not_to have_props(:stats)
  end

  it 'loads deferred props' do
    get dashboard_path
    expect(inertia).to have_deferred_props(:analytics)

    inertia_load_deferred_props
    expect(inertia).to have_props(analytics: be_present)
  end
end
```

---

### test-04: Implement end-to-end tests with Capybara

**Impact:** MEDIUM - Full integration testing

```ruby
# spec/system/users_spec.rb
RSpec.describe 'Users', type: :system do
  before do
    driven_by(:selenium_chrome_headless)
  end

  it 'creates a new user' do
    visit new_user_path

    fill_in 'Name', with: 'John Doe'
    fill_in 'Email', with: 'john@example.com'
    click_button 'Create User'

    expect(page).to have_content('User created successfully')
    expect(page).to have_content('John Doe')
  end
end
```

---

### test-05: Test flash messages after redirects

**Impact:** MEDIUM - Verify flash behavior

```ruby
RSpec.describe 'Creating users' do
  it 'shows success flash' do
    post users_path, params: { user: valid_attributes }
    follow_redirect!

    expect(inertia).to have_flash(notice: 'User created!')
  end
end
```

---

### test-06: Verify component rendering

**Impact:** MEDIUM - Ensure correct components load

```ruby
it 'renders correct component for action' do
  get users_path
  expect(inertia).to render_component('users/index')

  get new_user_path
  expect(inertia).to render_component('users/new')

  get user_path(user)
  expect(inertia).to render_component('users/show')
end
```

---

## 8. Advanced Patterns (MEDIUM)

Patterns for complex applications and edge cases.

---

### adv-01: Implement persistent layouts

**Impact:** MEDIUM - Maintain state across page navigation

**Problem:** Layout components remount on every navigation.

**Solution:**
```jsx
// pages/Users/Index.tsx
import AppLayout from '@/layouts/AppLayout'

function UsersIndex({ users }) {
  return <div>Users list...</div>
}

UsersIndex.layout = AppLayout
export default UsersIndex
```

**Nested layouts:**
```jsx
import MainLayout from '@/layouts/MainLayout'
import SettingsLayout from '@/layouts/SettingsLayout'

UserSettings.layout = [MainLayout, SettingsLayout]
```

**Default layout in app initialization:**
```javascript
createInertiaApp({
  resolve: async (name) => {
    const page = await pages[`../pages/${name}.tsx`]()
    page.default.layout = page.default.layout || MainLayout
    return page
  },
})
```

---

### adv-02: Use custom component path resolvers

**Impact:** LOW - Non-standard component organization

```ruby
# config/initializers/inertia_rails.rb
InertiaRails.configure do |config|
  config.component_path_resolver = ->(path:, action:) do
    # Custom path logic
    "modules/#{path.camelize}/views/#{action.camelize}"
  end
end
```

---

### adv-03: Configure prop transformers

**Impact:** MEDIUM - Consistent data transformation

```ruby
# Transform snake_case to camelCase for JavaScript
InertiaRails.configure do |config|
  config.prop_transformer = ->(props:) do
    props.deep_transform_keys { |key| key.to_s.camelize(:lower) }
  end
end
```

---

### adv-04: Handle SSR appropriately

**Impact:** MEDIUM - SEO and initial load performance

**Recommended: Use the `@inertiajs/vite` plugin** for simplified SSR. In development, SSR runs through the Vite dev server automatically — no separate Node.js process needed.

```ruby
# config/initializers/inertia_rails.rb
InertiaRails.configure do |config|
  config.ssr_enabled = true
  config.ssr_url = nil  # Auto-detect from Vite dev server

  # Production settings
  config.ssr_bundle = Rails.root.join('public/vite-ssr/ssr.js')
  config.ssr_cache = Rails.env.production?
  config.ssr_raise_on_error = !Rails.env.production?
end
```

```erb
<!-- In layout -->
<head>
  <%= inertia_ssr_head %>
</head>
```

---

### adv-05: Implement view transitions

**Impact:** LOW - Modern page transition animations

```jsx
<Link href="/users" viewTransition>
  Users
</Link>
```

```css
/* Global CSS */
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 0.3s;
}
```

---

### adv-06: Use scroll regions for complex layouts

**Impact:** LOW - Proper scroll handling in scrollable containers

```html
<div class="h-screen overflow-y-auto" scroll-region>
  <!-- Content that scrolls independently -->
</div>
```

Inertia tracks scroll position in elements with `scroll-region` attribute.

---

### adv-07: Handle events system effectively

**Impact:** MEDIUM - Hook into Inertia lifecycle

```javascript
import { router } from '@inertiajs/react'

// Global event listeners
router.on('before', (event) => {
  // Cancel navigation
  if (!confirm('Leave page?')) {
    event.preventDefault()
  }
})

router.on('start', () => {
  // Show loading state
})

router.on('finish', () => {
  // Hide loading state
})

router.on('navigate', (event) => {
  // Track page views
  analytics.track('page_view', { url: event.detail.page.url })
})

router.on('error', (errors) => {
  // Handle validation errors globally
  if (errors.session_expired) {
    router.visit('/login')
  }
})
```

**Event types:**
- `before` - Before visit starts (cancelable)
- `start` - Request initiated
- `progress` - File upload progress
- `success` - Successful response without errors
- `error` - Validation errors present
- `httpException` - Non-Inertia response (renamed from `invalid` in v3)
- `networkError` - Unexpected error (renamed from `exception` in v3)
- `finish` - Request completed
- `navigate` - After successful navigation
- `flash` - Flash data received

---

### adv-08: Use layout props for page-layout communication

**Impact:** MEDIUM - Share data between pages and persistent layouts

```tsx
// Page sets layout props
import { useLayoutProps } from '@inertiajs/react'
import AppLayout from '@/layouts/app-layout'

export default function Dashboard({ stats }) {
  useLayoutProps({ title: 'Dashboard', breadcrumbs: ['Home', 'Dashboard'] })
  return <div>Dashboard content</div>
}

Dashboard.layout = AppLayout

// Layout consumes layout props
export default function AppLayout({ children }) {
  const { title, breadcrumbs } = useLayoutProps()
  return (
    <div>
      <h1>{title}</h1>
      <main>{children}</main>
    </div>
  )
}
```

---

### adv-09: Configure the Vite plugin for optimal DX

**Impact:** HIGH - Simplifies page resolution and SSR setup

```javascript
// vite.config.js
import inertia from '@inertiajs/vite'

export default defineConfig({
  plugins: [
    inertia(),
    // ... framework plugin (react, vue, svelte)
  ],
})
```

The Vite plugin provides:
- Automatic page component resolution (no `import.meta.glob` needed)
- Simplified SSR (no separate entry point in development)
- `withApp` callback for adding providers/plugins

---

## New in v3

### props-10: Use prop transformer for consistent naming

**Impact:** MEDIUM - Consistent camelCase/snake_case conversion

```ruby
InertiaRails.configure do |config|
  config.prop_transformer = ->(props:) do
    props.deep_transform_keys { |key| key.to_s.camelize(:lower) }
  end
end
```

---

### forms-09: Use precognition for real-time validation

**Impact:** HIGH - Server-side validation without page navigation

```jsx
<Form action="/users" method="post" precognition>
  {({ errors, valid, invalid, validate }) => (
    <>
      <input
        type="email"
        name="email"
        onBlur={() => validate('email')}
      />
      {valid('email') && <span className="text-green-500">✓</span>}
      {invalid('email') && <span className="text-red-500">{errors.email}</span>}
    </>
  )}
</Form>
```

```ruby
# Prevent DB writes during precognition requests
InertiaRails.configure do |config|
  config.precognition_prevent_writes = true
end
```

---

### forms-10: Use useHttp for non-navigating requests

**Impact:** MEDIUM - API calls without triggering page visits

```jsx
import { useHttp } from '@inertiajs/react'

function SearchWidget() {
  const { post, processing } = useHttp()

  function search(query) {
    post('/api/search', {
      data: { query },
      onSuccess: (response) => setResults(response.data),
    })
  }
}
```

---

### nav-08: Use instant visits for perceived performance

**Impact:** MEDIUM-HIGH - Pages render immediately with shared props

```vue
<!-- Render Dashboard component immediately with shared props -->
<Link href="/dashboard" component="Dashboard">Dashboard</Link>

<!-- With intermediate data -->
<Link href="/users/123" component="Users/Show" :page-props="{ user: { name: 'Loading...' } }">
  View User
</Link>
```

---

### perf-08: Use InfiniteScroll component for pagination

**Impact:** MEDIUM - Built-in infinite scroll with server integration

```ruby
# Server
def index
  pagy, posts = pagy(Post.order(created_at: :desc), limit: 20)
  render inertia: {
    posts: InertiaRails.scroll(pagy) { posts.as_json(only: [:id, :title]) }
  }
end
```

```vue
<!-- Client -->
<InfiniteScroll :data="posts" component="posts">
  <template #default="{ items }">
    <div v-for="post in items" :key="post.id">{{ post.title }}</div>
  </template>
</InfiniteScroll>
```

---

### perf-09: Enable view transitions for smooth animations

**Impact:** LOW - Modern animated page transitions

```vue
<Link href="/users" view-transition>Users</Link>
```

```css
::view-transition-old(root) { animation: slide-out 0.3s ease; }
::view-transition-new(root) { animation: slide-in 0.3s ease; }
```

---

## Additional Resources

- [Inertia Rails Documentation](https://inertia-rails.dev/)
- [Inertia.js Documentation](https://inertiajs.com/)
- [GitHub: inertiajs/inertia-rails](https://github.com/inertiajs/inertia-rails)
- [Evil Martians: Inertia.js in Rails](https://evilmartians.com/chronicles/inertiajs-in-rails-a-new-era-of-effortless-integration)
