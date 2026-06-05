---
name: inertia-rails-performance
description: Optimize Inertia Rails application performance. Use when implementing code splitting, prefetching, deferred props, infinite scrolling, polling, or other performance optimizations.
license: MIT
metadata:
  author: community
  version: "2.0.0"
user-invocable: true
---

# Inertia Rails Performance Optimization

Comprehensive guide to optimizing Inertia Rails applications for speed and efficiency.

## Props Optimization

### Return Minimal Data

**Impact:** CRITICAL - Reduces payload size, improves security

```ruby
# Bad - sends entire model
render inertia: { users: User.all }

# Good - only required fields
render inertia: {
  users: User.all.as_json(only: [:id, :name, :email, :avatar_url])
}

# Better - use select to avoid loading unnecessary columns
render inertia: {
  users: User.select(:id, :name, :email, :avatar_url).as_json
}
```

### Lazy Evaluation with Lambdas

**Impact:** HIGH - Prevents unnecessary queries

```ruby
# Bad - evaluates even if not used
inertia_share do
  {
    recent_posts: Post.recent.limit(5).as_json,
    total_users: User.count
  }
end

# Good - only evaluates when accessed
inertia_share do
  {
    recent_posts: -> { Post.recent.limit(5).as_json },
    total_users: -> { User.count }
  }
end
```

## Deferred Props

Load non-critical data after initial page render:

```ruby
def dashboard
  render inertia: {
    # Critical data - loads immediately
    user: current_user.as_json(only: [:id, :name]),

    # Non-critical - loads after page renders
    analytics: InertiaRails.defer { Analytics.for_user(current_user) },

    # Group related deferred props (fetched in parallel)
    recommendations: InertiaRails.defer(group: 'suggestions') {
      Recommendations.for(current_user)
    },
    trending: InertiaRails.defer(group: 'suggestions') {
      Post.trending.limit(10).as_json
    },

    # Separate group - fetched in parallel with 'suggestions'
    notifications: InertiaRails.defer(group: 'alerts') {
      current_user.notifications.unread.as_json
    }
  }
end
```

### Frontend Handling

```jsx
import { Deferred } from '@inertiajs/react'

export default function Dashboard({ user, analytics, recommendations, trending }) {
  return (
    <div>
      {/* Immediate render */}
      <h1>Welcome, {user.name}</h1>

      {/* Shows loading state then content */}
      <Deferred data="analytics" fallback={<AnalyticsSkeleton />}>
        <AnalyticsChart data={analytics} />
      </Deferred>

      {/* Multiple deferred props */}
      <Deferred data={['recommendations', 'trending']} fallback={<RecommendationsSkeleton />}>
        <RecommendationsList items={recommendations} />
        <TrendingList items={trending} />
      </Deferred>
    </div>
  )
}
```

## Partial Reloads

Refresh only specific props without full page reload:

```javascript
import { router } from '@inertiajs/react'

// Reload only 'users' prop
router.reload({ only: ['users'] })

// Exclude specific props
router.reload({ except: ['analytics'] })

// With data parameters
router.reload({
  only: ['users'],
  data: { search: 'john', page: 2 }
})
```

### Server-Side Optimization

```ruby
def index
  render inertia: {
    # Standard prop - always included
    users: User.search(params[:search]).page(params[:page]).as_json,

    # Optional prop - only when explicitly requested
    statistics: InertiaRails.optional { compute_statistics },

    # Always prop - included even in partial reloads
    csrf_token: InertiaRails.always { form_authenticity_token }
  }
end
```

### Link with Partial Reload

```jsx
<Link href="/users" only={['users']}>
  Refresh Users
</Link>

<Link href="/users?search=john" only={['users']} preserveState>
  Search John
</Link>
```

## Code Splitting

Split your bundle to load pages on demand:

### Vite (Recommended)

```javascript
// Lazy loading - loads pages on demand
const pages = import.meta.glob('../pages/**/*.tsx')

createInertiaApp({
  resolve: (name) => {
    return pages[`../pages/${name}.tsx`]()  // Note: returns Promise
  },
  // ...
})
```

### Eager Loading (Small Apps)

```javascript
// All pages in initial bundle - faster for small apps
const pages = import.meta.glob('../pages/**/*.tsx', { eager: true })

createInertiaApp({
  resolve: (name) => pages[`../pages/${name}.tsx`],
  // ...
})
```

### Hybrid Approach

```javascript
// Eager load critical pages, lazy load others
const criticalPages = import.meta.glob([
  '../pages/Home.tsx',
  '../pages/Dashboard.tsx',
], { eager: true })

const otherPages = import.meta.glob([
  '../pages/**/*.tsx',
  '!../pages/Home.tsx',
  '!../pages/Dashboard.tsx',
])

createInertiaApp({
  resolve: (name) => {
    const page = criticalPages[`../pages/${name}.tsx`]
    if (page) return page

    return otherPages[`../pages/${name}.tsx`]()
  },
})
```

## Prefetching

Load pages before user navigates:

### Link Prefetching

```jsx
{/* Prefetch on hover (default: 75ms delay) */}
<Link href="/users" prefetch>Users</Link>

{/* Prefetch immediately on mount */}
<Link href="/dashboard" prefetch="mount">Dashboard</Link>

{/* Prefetch on mousedown */}
<Link href="/reports" prefetch="click">Reports</Link>

{/* Multiple strategies */}
<Link href="/settings" prefetch={['mount', 'hover']}>Settings</Link>
```

### Cache Configuration

```jsx
{/* Cache for 1 minute */}
<Link href="/users" prefetch cacheFor="1m">Users</Link>

{/* Cache for 30 seconds, stale for 1 minute (stale-while-revalidate) */}
<Link href="/users" prefetch cacheFor={['30s', '1m']}>Users</Link>
```

### Programmatic Prefetching

```javascript
import { router } from '@inertiajs/react'

// Prefetch a page
router.prefetch('/users')

// With options
router.prefetch('/users', {
  method: 'get',
  data: { page: 2 }
}, {
  cacheFor: '1m'
})
```

### Cache Tags for Invalidation

```jsx
<Link href="/users" prefetch cacheTags="users">Users</Link>
<Link href="/users/active" prefetch cacheTags="users">Active Users</Link>

{/* Form that invalidates user cache */}
<Form action="/users" method="post" invalidateCacheTags="users">
  {/* ... */}
</Form>
```

```javascript
// Manual invalidation
router.flushByCacheTags('users')

// Flush all prefetch cache
router.flushAll()
```

## Instant Visits (v3)

Render the target page immediately with shared props while the server request is in flight. When the response arrives, the page is updated with the full props.

### Link with Instant Visit

```jsx
{/* Specify the target component to render immediately */}
<Link href="/dashboard" component="Dashboard">
  Dashboard
</Link>

{/* With intermediate page props */}
<Link
  href="/users/123"
  component="Users/Show"
  pageProps={{ user: { name: 'Loading...' } }}
>
  View User
</Link>
```

### Programmatic Instant Visit

```javascript
router.visit('/dashboard', {
  component: 'Dashboard',
  pageProps: { title: 'Loading dashboard...' }
})
```

### Server-Side Configuration

Enable `expose_shared_prop_keys` (default: true) so the client knows which shared props are available for instant visits:

```ruby
InertiaRails.configure do |config|
  config.expose_shared_prop_keys = true
end
```

Instant visits work best when pages share data through `inertia_share` — the shared props are available immediately, and page-specific props load when the server responds.

## Infinite Scrolling

### Server-Side with InertiaRails.scroll()

The `InertiaRails.scroll()` method integrates with pagination gems (Pagy, Kaminari) for seamless infinite scrolling:

```ruby
# Using Pagy (recommended)
def index
  pagy, posts = pagy(Post.order(created_at: :desc), limit: 20)

  render inertia: {
    posts: InertiaRails.scroll(pagy) {
      posts.as_json(only: [:id, :title, :excerpt, :created_at])
    }
  }
end

# Using Kaminari
def index
  posts = Post.order(created_at: :desc).page(params[:page]).per(20)

  render inertia: {
    posts: InertiaRails.scroll(posts) {
      posts.as_json(only: [:id, :title, :excerpt])
    }
  }
end
```

### Frontend with InfiniteScroll Component (v3)

```jsx
import { InfiniteScroll } from '@inertiajs/react'

export default function PostsIndex({ posts }) {
  return (
    <InfiniteScroll data={posts} component="posts">
      {({ items }) => items.map(post => (
        <div key={post.id}>
          <h2>{post.title}</h2>
          <p>{post.excerpt}</p>
        </div>
      ))}
    </InfiniteScroll>
  )
}
```

### InfiniteScroll Options

```jsx
{/* Bidirectional scrolling */}
<InfiniteScroll data={messages} component="messages" direction="both" />

{/* Reverse scrolling (chat-like) */}
<InfiniteScroll data={messages} component="messages" direction="reverse" />

{/* Manual mode (click to load) */}
<InfiniteScroll data={posts} component="posts" manual
  trigger={<button>Load More</button>}
/>

{/* URL synchronization */}
<InfiniteScroll data={posts} component="posts" preserveUrl />
```

### Manual Infinite Scrolling with Merge Props

For custom implementations without the InfiniteScroll component:

```ruby
def index
  posts = Post.order(created_at: :desc).page(params[:page]).per(20)

  render inertia: {
    posts: InertiaRails.merge { posts.as_json(only: [:id, :title, :excerpt]) },
    pagination: {
      current_page: posts.current_page,
      total_pages: posts.total_pages,
      has_more: !posts.last_page?
    }
  }
end
```

```jsx
import { router } from '@inertiajs/react'
import { useState } from 'react'

export default function PostsIndex({ posts, pagination }) {
  const [loading, setLoading] = useState(false)

  function loadMore() {
    if (loading || !pagination.has_more) return

    setLoading(true)
    router.reload({
      data: { page: pagination.current_page + 1 },
      only: ['posts', 'pagination'],
      preserveScroll: true,
      preserveState: true,
      onFinish: () => setLoading(false),
    })
  }

  return (
    <div>
      {posts.map(post => (
        <div key={post.id}>
          <h2>{post.title}</h2>
          <p>{post.excerpt}</p>
        </div>
      ))}
      {pagination.has_more && (
        <button onClick={loadMore} disabled={loading}>
          {loading ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  )
}
```

### Merge Options

```ruby
# Append to array (default)
InertiaRails.merge { items }

# Deep merge objects with item matching
InertiaRails.deep_merge { updated_items }
InertiaRails.deep_merge(match_on: 'id') { items }
```

## Polling

Real-time updates without WebSockets:

```jsx
import { usePoll } from '@inertiajs/react'

export default function Notifications({ notifications }) {
  // Poll every 5 seconds
  usePoll(5000)

  // With options
  usePoll(5000, {
    only: ['notifications', 'messages'],
    onStart: () => console.log('Polling...'),
    onFinish: () => console.log('Poll complete'),
  })

  // Manual control
  const { start, stop } = usePoll(5000, {}, { autoStart: false })

  return (
    <div>
      {notifications.map(n => <div key={n.id}>{n.message}</div>)}
    </div>
  )
}
```

### Throttling in Background

```javascript
// Default: 90% throttle in background tabs
usePoll(5000)

// Keep polling at full speed in background
usePoll(5000, {}, { keepAlive: true })
```

## Progress Indicators

### Default NProgress

```javascript
createInertiaApp({
  progress: {
    delay: 250,        // Show after 250ms (skip quick loads)
    color: '#29d',     // Progress bar color
    includeCSS: true,  // Include default styles
    showProgress: true // Show percentage
  },
})
```

### Disable for Specific Requests

```javascript
router.visit('/quick-action', {
  showProgress: false
})
```

### Async Requests

```javascript
// Background request without progress indicator
router.post('/analytics/track', { event: 'view' }, {
  async: true,
  showProgress: false
})

// Async with progress
router.post('/upload', formData, {
  async: true,
  showProgress: true
})
```

## Once Props

Data resolved once and remembered across navigations:

```ruby
inertia_share do
  {
    # Evaluated once per session, not on every navigation
    app_config: InertiaRails.once { AppConfig.to_json },
    feature_flags: InertiaRails.once { FeatureFlags.current }
  }
end
```

Combined with optional/deferred:

```ruby
render inertia: {
  # Optional + once: resolved only when requested, then remembered
  user_preferences: InertiaRails.optional(once: true) {
    current_user.preferences.as_json
  }
}
```

### Once Props Configuration

```ruby
render inertia: {
  # Expire after a time period
  app_config: InertiaRails.once(expires_in: 1.day) { AppConfig.to_json },

  # Force refresh based on a condition
  feature_flags: InertiaRails.once(fresh: current_user.updated_at > 1.hour.ago) {
    FeatureFlags.for_user(current_user)
  },

  # Share cache key across pages (any page can refresh this data)
  notifications_count: InertiaRails.once(key: 'notifications') {
    current_user.unread_notifications_count
  }
}
```

## Asset Versioning

Ensure users get fresh assets after deployment:

```ruby
# config/initializers/inertia_rails.rb
InertiaRails.configure do |config|
  # Using ViteRuby digest
  config.version = -> { ViteRuby.digest }

  # Or custom version
  config.version = -> { ENV['ASSET_VERSION'] || Rails.application.config.assets_version }
end
```

When version changes, Inertia triggers a full page reload instead of XHR.

## Database Query Optimization

### Eager Loading

```ruby
def index
  # Bad - N+1 queries
  users = User.all
  render inertia: {
    users: users.map { |u| u.as_json(include: :posts) }
  }

  # Good - eager load
  users = User.includes(:posts)
  render inertia: {
    users: users.as_json(include: { posts: { only: [:id, :title] } })
  }
end
```

### Selective Loading

```ruby
def index
  # Only select needed columns
  users = User
    .select(:id, :name, :email, :created_at)
    .includes(:profile)
    .order(created_at: :desc)
    .limit(50)

  render inertia: {
    users: users.as_json(
      only: [:id, :name, :email],
      include: { profile: { only: [:avatar_url] } }
    )
  }
end
```

## Caching Strategies

### Fragment Caching

```ruby
def index
  render inertia: {
    stats: Rails.cache.fetch('dashboard_stats', expires_in: 5.minutes) do
      compute_expensive_stats
    end
  }
end
```

### Response Caching with ETags

```ruby
def show
  user = User.find(params[:id])

  if stale?(user)
    render inertia: { user: user.as_json(only: [:id, :name]) }
  end
end
```

## Performance Monitoring

### Track Slow Requests

```ruby
# app/controllers/application_controller.rb
around_action :track_request_time

private

def track_request_time
  start = Time.current
  yield
  duration = Time.current - start

  if duration > 1.second
    Rails.logger.warn "Slow request: #{request.path} took #{duration.round(2)}s"
  end
end
```

### Client-Side Metrics

```javascript
router.on('start', (event) => {
  event.detail.visit.startTime = performance.now()
})

router.on('finish', (event) => {
  const duration = performance.now() - event.detail.visit.startTime
  if (duration > 1000) {
    console.warn(`Slow navigation to ${event.detail.visit.url}: ${duration}ms`)
  }
})
```

## WhenVisible - Lazy Load on Viewport Entry

Load data only when elements become visible using Intersection Observer:

### Basic Usage

```jsx
import { WhenVisible } from '@inertiajs/react'

export default function Dashboard({ users, teams }) {
  return (
    <div>
      {/* Main content loads immediately */}
      <UserList users={users} />

      {/* Teams load when scrolled into view */}
      <WhenVisible data="teams" fallback={<TeamsSkeleton />}>
        <TeamList teams={teams} />
      </WhenVisible>
    </div>
  )
}
```

### Multiple Props

```jsx
<WhenVisible data={['teams', 'projects']} fallback={<LoadingSpinner />}>
  <Dashboard teams={teams} projects={projects} />
</WhenVisible>
```

### Configuration Options

```jsx
{/* Start loading 500px before element is visible */}
<WhenVisible data="comments" buffer={500}>
  <Comments comments={comments} />
</WhenVisible>

{/* Custom wrapper element */}
<WhenVisible data="stats" as="section">
  <Stats stats={stats} />
</WhenVisible>

{/* Reload every time element becomes visible */}
<WhenVisible data="posts" always>
  <PostList posts={posts} />
</WhenVisible>
```

### With Form Submissions

Prevent reloading WhenVisible props after form submission:

```javascript
form.post('/comments', {
  except: ['teams'],  // Don't reload teams managed by WhenVisible
})
```

## Scroll Management

### Scroll Preservation

```javascript
// Always preserve scroll position
router.visit('/users', { preserveScroll: true })

// Preserve only on validation errors
router.visit('/users', { preserveScroll: 'errors' })

// Conditional preservation
router.visit('/users', {
  preserveScroll: (page) => page.props.shouldPreserve
})
```

### Link with Scroll Control

```jsx
<Link href="/users" preserveScroll>Users</Link>
```

### Scroll Regions

For scrollable containers (not document body):

```jsx
export default function AppLayout({ children }) {
  return (
    <div className="h-screen flex">
      {/* Sidebar with independent scroll */}
      <nav className="w-64 overflow-y-auto" scroll-region>
        <SidebarContent />
      </nav>

      {/* Main content with independent scroll */}
      <main className="flex-1 overflow-y-auto" scroll-region>
        {children}
      </main>
    </div>
  )
}
```

Inertia tracks and restores scroll position for elements with `scroll-region` attribute.

### Reset Scroll Programmatically

```javascript
router.visit('/users', {
  preserveScroll: false,  // Reset to top (default)
})
```

## View Transitions (v3)

Use the View Transitions API for smooth animated transitions between pages:

```javascript
import { router } from '@inertiajs/react'

// Enable view transitions globally
router.on('before', (event) => {
  event.detail.visit.viewTransition = true
})
```

```jsx
{/* Per-link view transitions */}
<Link href="/users" viewTransition>Users</Link>
```

```css
/* Define transition animations */
::view-transition-old(root) {
  animation: slide-out 0.3s ease-in-out;
}

::view-transition-new(root) {
  animation: slide-in 0.3s ease-in-out;
}
```

## Best Practices Summary

1. **Props**: Return only necessary data, use lazy evaluation
2. **Deferred Props**: Move non-critical data to deferred loading
3. **Partial Reloads**: Refresh only changed data
4. **Code Splitting**: Lazy load pages for large applications
5. **Prefetching**: Preload likely next pages
6. **Infinite Scroll**: Use merge props for seamless pagination
7. **Polling**: Use sparingly with proper throttling
8. **Database**: Eager load associations, select only needed columns
9. **Caching**: Cache expensive computations
10. **Monitoring**: Track and optimize slow requests
11. **WhenVisible**: Lazy load below-the-fold content
12. **Scroll Regions**: Use for complex layouts with multiple scroll areas
13. **Instant Visits**: Use for perceived instant navigation to known pages
14. **View Transitions**: Add smooth animations between page transitions
