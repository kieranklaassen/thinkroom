---
name: inertia-rails-cookbook
description: Recipes and patterns for common Inertia Rails use cases. Includes modal dialogs, shadcn/ui integration, search with filters, wizard flows, and other advanced patterns.
license: MIT
metadata:
  author: community
  version: "2.0.0"
user-invocable: true
---

# Inertia Rails Cookbook

Practical recipes for common patterns and integrations in Inertia Rails applications.

## Working with the Official Starter Kits

The official starter kits provide a complete foundation. Here's how to customize them for your needs.

### Starter Kit Structure (React)

```
app/
├── controllers/
│   ├── application_controller.rb    # Shared data setup
│   ├── dashboard_controller.rb      # Example authenticated page
│   ├── home_controller.rb           # Public landing page
│   ├── sessions_controller.rb       # Login/logout
│   ├── users_controller.rb          # Registration
│   ├── identity/                    # Password reset
│   └── settings/                    # User settings
├── frontend/
│   ├── components/
│   │   ├── ui/                      # shadcn/ui components
│   │   ├── nav-main.tsx             # Main navigation
│   │   ├── app-sidebar.tsx          # Sidebar component
│   │   └── user-menu-content.tsx    # User dropdown
│   ├── hooks/
│   │   ├── use-flash.tsx            # Flash message hook
│   │   └── use-appearance.tsx       # Dark mode hook
│   ├── layouts/
│   │   ├── app-layout.tsx           # Main app layout
│   │   ├── auth-layout.tsx          # Auth pages layout
│   │   └── app/
│   │       ├── app-sidebar-layout.tsx
│   │       └── app-header-layout.tsx
│   ├── pages/
│   │   ├── dashboard/index.tsx      # Dashboard page
│   │   ├── home/index.tsx           # Landing page
│   │   ├── sessions/new.tsx         # Login page
│   │   ├── users/new.tsx            # Registration page
│   │   └── settings/                # Settings pages
│   └── types/
│       └── index.ts                 # Shared TypeScript types
```

### Adding a New Resource

**1. Generate the controller:**
```bash
bin/rails generate controller Products index show new create edit update destroy
```

**2. Create the page components:**

```tsx
// app/frontend/pages/products/index.tsx
import { Head, Link } from '@inertiajs/react'
import AppLayout from '@/layouts/app-layout'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'

interface Product {
  id: number
  name: string
  price: number
}

interface Props {
  products: Product[]
}

export default function ProductsIndex({ products }: Props) {
  return (
    <AppLayout>
      <Head title="Products" />

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Products</h1>
        <Button asChild>
          <Link href="/products/new">Add Product</Link>
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.id}>
              <TableCell>{product.name}</TableCell>
              <TableCell>${product.price}</TableCell>
              <TableCell>
                <Link href={`/products/${product.id}/edit`}>Edit</Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AppLayout>
  )
}
```

**3. Update navigation:**

```tsx
// app/frontend/components/nav-main.tsx
const navItems = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'Products', href: '/products', icon: Package },  // Add this
  // ...
]
```

**4. Add route:**
```ruby
# config/routes.rb
resources :products
```

### Adding New shadcn/ui Components

The starter kit includes many components, but you can add more:

```bash
# Add a specific component
npx shadcn@latest add toast
npx shadcn@latest add calendar
npx shadcn@latest add data-table

# See all available components
npx shadcn@latest add
```

### Customizing the Layout

**Switch between sidebar and header layouts:**

```tsx
// app/frontend/layouts/app-layout.tsx
import AppSidebarLayout from '@/layouts/app/app-sidebar-layout'
import AppHeaderLayout from '@/layouts/app/app-header-layout'

// Use sidebar (default)
export default function AppLayout({ children }: Props) {
  return <AppSidebarLayout>{children}</AppSidebarLayout>
}

// Or use header layout
export default function AppLayout({ children }: Props) {
  return <AppHeaderLayout>{children}</AppHeaderLayout>
}
```

### Extending Types

```tsx
// app/frontend/types/index.ts
export interface User {
  id: number
  name: string
  email: string
  avatar_url: string | null
}

// Add your own types
export interface Product {
  id: number
  name: string
  description: string
  price: number
  created_at: string
}

export interface PageProps {
  auth: {
    user: User | null
  }
  flash: {
    success?: string
    error?: string
  }
}
```

### Using the Flash Hook

The starter kit includes a flash message system with Sonner toasts:

```tsx
// Already set up in the layout, just use flash in your controller
class ProductsController < ApplicationController
  def create
    @product = Product.create(product_params)
    redirect_to products_path, notice: 'Product created!'
  end
end
```

The `use-flash` hook automatically displays flash messages as toasts.

### Removing Features You Don't Need

**Remove settings pages:**
```bash
rm -rf app/frontend/pages/settings
rm -rf app/controllers/settings
# Remove routes in config/routes.rb
```

**Remove authentication (for internal tools):**
```bash
rm -rf app/frontend/pages/sessions
rm -rf app/frontend/pages/users
rm -rf app/frontend/pages/identity
rm app/controllers/sessions_controller.rb
rm app/controllers/users_controller.rb
rm -rf app/controllers/identity
# Update routes and ApplicationController
```

---

## Layout Props (v3)

Share data between pages and their persistent layouts using `useLayoutProps`:

### Static Layout Props

```tsx
// app/frontend/pages/dashboard/index.tsx
import AppLayout from '@/layouts/app-layout'

export default function Dashboard({ stats }) {
  return <div>Dashboard content</div>
}

// Pass static props to the layout
Dashboard.layout = [AppLayout, { title: 'Dashboard', breadcrumbs: ['Home', 'Dashboard'] }]
```

### Dynamic Layout Props

```tsx
import { useLayoutProps } from '@inertiajs/react'
import AppLayout from '@/layouts/app-layout'

export default function UserProfile({ user }) {
  // Set layout props dynamically
  useLayoutProps({ title: user.name, breadcrumbs: ['Users', user.name] })

  return <div>{user.name}'s profile</div>
}

UserProfile.layout = AppLayout
```

### In the Layout

```tsx
// app/frontend/layouts/app-layout.tsx
import { useLayoutProps } from '@inertiajs/react'

export default function AppLayout({ children }) {
  const { title, breadcrumbs } = useLayoutProps()

  return (
    <div>
      <header>
        <h1>{title}</h1>
        <nav>{breadcrumbs?.join(' > ')}</nav>
      </header>
      <main>{children}</main>
    </div>
  )
}
```

---

## Inertia Modal - Render Pages as Dialogs

The `inertia_rails-contrib` gem and `@inertiaui/modal` package let you render any Inertia page as a modal dialog.

### Installation

```bash
# Ruby gem (optional, for base_url helper)
bundle add inertia_rails-contrib

# NPM package (Vue)
npm install @inertiaui/modal-vue

# NPM package (React)
npm install @inertiaui/modal-react
```

### Setup (React)

```javascript
// app/frontend/entrypoints/application.js
import { createInertiaApp } from '@inertiajs/react'
import { createRoot } from 'react-dom/client'
import { renderApp } from '@inertiaui/modal-react'

createInertiaApp({
  resolve: (name) => {
    const pages = import.meta.glob('../pages/**/*.tsx', { eager: true })
    return pages[`../pages/${name}.tsx`]
  },
  setup({ el, App, props }) {
    createRoot(el).render(renderApp(App, props))
  },
})
```

### Tailwind Configuration

```javascript
// tailwind.config.js (v3)
module.exports = {
  content: [
    // ... your content paths
    './node_modules/@inertiaui/modal-react/src/**/*.{js,jsx,ts,tsx}',
  ],
}
```

```css
/* For Tailwind v4 */
@import "tailwindcss";
@source '../../../node_modules/@inertiaui/modal-react';
```

### Basic Usage

**Open a page as modal:**
```jsx
import { ModalLink } from '@inertiaui/modal-react'

export default function UsersList() {
  return (
    <ModalLink href="/users/create">
      Create User
    </ModalLink>
  )
}
```

**Wrap page content in Modal:**
```jsx
// pages/users/create.tsx
import { Modal } from '@inertiaui/modal-react'

export default function CreateUser({ roles }) {
  return (
    <Modal>
      <h2>Create User</h2>
      <UserForm roles={roles} />
    </Modal>
  )
}
```

### Modal with Base URL

Enable URL updates and browser history:

**Controller:**
```ruby
class UsersController < ApplicationController
  def create
    render inertia_modal: {
      roles: Role.all.as_json
    }, base_url: users_path
  end
end
```

**Link with navigation:**
```jsx
<ModalLink href="/users/create" navigate>
  Create User
</ModalLink>
```

Now the URL changes to `/users/create` when opened, supports browser back button, and can be bookmarked.

### Slideover Variant

```jsx
<Modal slideover>
  <h2>User Details</h2>
  {/* Content slides in from the side */}
</Modal>
```

### Nested Modals

```jsx
<Modal>
  <h2>Edit User</h2>
  <UserForm />

  {/* Open another modal from within */}
  <ModalLink href="/roles/create">
    Add New Role
  </ModalLink>
</Modal>
```

### Closing Modals

```jsx
import { Modal } from '@inertiaui/modal-react'

export default function EditUser({ onClose }) {
  return (
    <Modal onClose={onClose}>
      <button onClick={onClose}>Cancel</button>
    </Modal>
  )
}
```

---

## Integrating shadcn/ui

Use shadcn/ui components with Inertia Rails for a polished UI.

### Setup (React)

```bash
# Initialize shadcn/ui
npx shadcn@latest init

# Add components
npx shadcn@latest add button input card form
```

### Form with shadcn/ui

```jsx
import { useForm } from '@inertiajs/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function LoginForm() {
  const { data, setData, post, processing, errors } = useForm({
    email: '',
    password: '',
  })

  function submit(e) {
    e.preventDefault()
    post('/login')
  }

  return (
    <Card className="w-[400px]">
      <CardHeader>
        <CardTitle>Login</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={data.email}
              onChange={(e) => setData('email', e.target.value)}
              placeholder="you@example.com"
            />
            {errors.email && (
              <p className="text-sm text-red-500">{errors.email}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={data.password}
              onChange={(e) => setData('password', e.target.value)}
            />
          </div>

          <Button type="submit" disabled={processing} className="w-full">
            {processing ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
```

### Data Table with Sorting and Filtering

```jsx
import { router, usePage } from '@inertiajs/react'
import { useState, useCallback } from 'react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Link } from '@inertiajs/react'
import { useDebouncedCallback } from 'use-debounce'

export default function UsersTable({ users, filters }) {
  const [search, setSearch] = useState(filters.search || '')
  const [sort, setSort] = useState(filters.sort || 'name')
  const [direction, setDirection] = useState(filters.direction || 'asc')

  const debouncedSearch = useDebouncedCallback((value) => {
    router.get('/users', { search: value, sort, direction }, {
      preserveState: true,
      replace: true,
    })
  }, 300)

  function toggleSort(column) {
    const newDirection = sort === column && direction === 'asc' ? 'desc' : 'asc'
    setSort(column)
    setDirection(newDirection)
    router.get('/users', { search, sort: column, direction: newDirection }, {
      preserveState: true,
      replace: true,
    })
  }

  return (
    <div className="space-y-4">
      <Input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          debouncedSearch(e.target.value)
        }}
        placeholder="Search users..."
        className="max-w-sm"
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Button variant="ghost" onClick={() => toggleSort('name')}>
                Name {sort === 'name' && (direction === 'asc' ? '↑' : '↓')}
              </Button>
            </TableHead>
            <TableHead>
              <Button variant="ghost" onClick={() => toggleSort('email')}>
                Email {sort === 'email' && (direction === 'asc' ? '↑' : '↓')}
              </Button>
            </TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell>{user.name}</TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                <Link href={`/users/${user.id}/edit`}>Edit</Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
```

---

## Search with Filters

### Controller

```ruby
class UsersController < ApplicationController
  def index
    users = User.all

    # Apply search
    if params[:search].present?
      users = users.where('name ILIKE ? OR email ILIKE ?',
        "%#{params[:search]}%", "%#{params[:search]}%")
    end

    # Apply filters
    users = users.where(role: params[:role]) if params[:role].present?
    users = users.where(active: params[:active]) if params[:active].present?

    # Apply sorting
    sort_column = %w[name email created_at].include?(params[:sort]) ? params[:sort] : 'name'
    sort_direction = params[:direction] == 'desc' ? 'desc' : 'asc'
    users = users.order("#{sort_column} #{sort_direction}")

    # Paginate
    users = users.page(params[:page]).per(20)

    render inertia: {
      users: users.as_json(only: [:id, :name, :email, :role, :active]),
      filters: {
        search: params[:search],
        role: params[:role],
        active: params[:active],
        sort: sort_column,
        direction: sort_direction,
      },
      pagination: {
        current_page: users.current_page,
        total_pages: users.total_pages,
        total_count: users.total_count,
      }
    }
  end
end
```

### Frontend with URL Sync

```jsx
import { router } from '@inertiajs/react'
import { useState } from 'react'
import { useDebouncedCallback } from 'use-debounce'

export default function UsersIndex({ users, filters, pagination }) {
  const [search, setSearch] = useState(filters.search || '')
  const [role, setRole] = useState(filters.role || '')
  const [active, setActive] = useState(filters.active || '')

  function applyFilters(overrides = {}) {
    router.get('/users', {
      search: search || undefined,
      role: role || undefined,
      active: active || undefined,
      ...overrides,
    }, {
      preserveState: true,
      replace: true,
    })
  }

  const debouncedSearch = useDebouncedCallback(() => applyFilters(), 300)

  function clearFilters() {
    setSearch('')
    setRole('')
    setActive('')
    router.get('/users', {}, { preserveState: true, replace: true })
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); debouncedSearch() }}
          placeholder="Search..."
          className="input"
        />

        <select value={role} onChange={(e) => { setRole(e.target.value); applyFilters({ role: e.target.value }) }} className="select">
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="user">User</option>
        </select>

        <select value={active} onChange={(e) => { setActive(e.target.value); applyFilters({ active: e.target.value }) }} className="select">
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>

        <button onClick={clearFilters}>Clear</button>
      </div>

      <UserTable users={users} />
      <Pagination pagination={pagination} />
    </div>
  )
}
```

---

## Multi-Step Wizard

### Controller

```ruby
class OnboardingController < ApplicationController
  def show
    step = params[:step]&.to_i || 1

    render inertia: "onboarding/step#{step}", props: {
      step: step,
      total_steps: 4,
      data: session[:onboarding] || {}
    }
  end

  def update
    step = params[:step].to_i

    # Merge step data into session
    session[:onboarding] ||= {}
    session[:onboarding].merge!(step_params.to_h)

    if step < 4
      redirect_to onboarding_path(step: step + 1)
    else
      # Complete onboarding
      User.create!(session[:onboarding])
      session.delete(:onboarding)
      redirect_to dashboard_path, notice: 'Welcome!'
    end
  end

  private

  def step_params
    case params[:step].to_i
    when 1 then params.permit(:name, :email)
    when 2 then params.permit(:company, :role)
    when 3 then params.permit(:preferences)
    when 4 then params.permit(:terms_accepted)
    end
  end
end
```

### Wizard Component

```jsx
import { useForm, router } from '@inertiajs/react'

export default function WizardStep({ step, total_steps, data, children }) {
  const form = useForm(data)

  function next(e) {
    e.preventDefault()
    form.post(`/onboarding?step=${step}`)
  }

  function back() {
    router.get(`/onboarding?step=${step - 1}`)
  }

  return (
    <div>
      {/* Progress indicator */}
      <div className="flex gap-2 mb-8">
        {Array.from({ length: total_steps }, (_, i) => i + 1).map((i) => (
          <div
            key={i}
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              i <= step ? 'bg-blue-500 text-white' : 'bg-gray-200'
            }`}
          >
            {i}
          </div>
        ))}
      </div>

      <form onSubmit={next}>
        {typeof children === 'function' ? children({ form }) : children}

        <div className="flex gap-4 mt-8">
          {step > 1 && (
            <button type="button" onClick={back}>Back</button>
          )}
          <button type="submit" disabled={form.processing}>
            {step === total_steps ? 'Complete' : 'Next'}
          </button>
        </div>
      </form>
    </div>
  )
}
```

---

## Flash Messages with Toast

### Shared Data Setup

```ruby
# app/controllers/application_controller.rb
class ApplicationController < ActionController::Base
  inertia_share flash: -> {
    {
      success: flash.notice,
      error: flash.alert,
      info: flash[:info],
      warning: flash[:warning]
    }.compact
  }
end
```

### Toast Component (React)

```jsx
// components/FlashMessages.tsx
import { usePage } from '@inertiajs/react'
import { useEffect, useState } from 'react'

interface Toast {
  id: number
  type: string
  message: string
}

export default function FlashMessages() {
  const { flash } = usePage().props
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    if (!flash) return

    Object.entries(flash).forEach(([type, message]) => {
      if (message) {
        const id = Date.now() + Math.random()
        setToasts((prev) => [...prev, { id, type, message: message as string }])

        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id))
        }, 5000)
      }
    })
  }, [flash])

  const colorMap: Record<string, string> = {
    success: 'bg-green-500 text-white',
    error: 'bg-red-500 text-white',
    info: 'bg-blue-500 text-white',
    warning: 'bg-yellow-500 text-black',
  }

  return (
    <div className="fixed top-4 right-4 space-y-2 z-50">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`px-4 py-3 rounded-lg shadow-lg transition-all ${colorMap[toast.type] || 'bg-gray-500 text-white'}`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  )
}
```

### Usage in Layout

```jsx
// layouts/AppLayout.tsx
import FlashMessages from '@/components/FlashMessages'

export default function AppLayout({ children }) {
  return (
    <div>
      <FlashMessages />
      <nav>{/* ... */}</nav>
      <main>{children}</main>
    </div>
  )
}
```

---

## Flash API (v3)

Inertia.js v3 introduces a dedicated Flash API for richer flash data beyond simple key-value strings.

### Server-Side

```ruby
class PostsController < ApplicationController
  def create
    post = Post.create!(post_params)

    # Standard Rails flash (exposed via flash_keys config)
    redirect_to posts_path, notice: 'Post created!'
  end

  def update
    post = Post.find(params[:id])

    # Rich flash data via flash.inertia
    flash.inertia[:undo] = { url: undo_post_path(post), expires_in: 30 }

    # Current-request-only flash
    flash.now.inertia[:notification] = { type: 'info', message: 'Saving...' }

    redirect_to post_path(post)
  end
end
```

### Frontend

```javascript
import { usePage, router } from '@inertiajs/react'

function FlashHandler() {
  const { flash } = usePage().props

  // Access standard flash
  if (flash.notice) showToast(flash.notice)

  // Access rich flash data
  if (flash.undo) {
    showUndoToast(flash.undo.message, () => {
      router.post(flash.undo.url)
    })
  }
}

// Client-side flash (no server roundtrip)
router.flash({ notice: 'Saved locally' })
```

### Configure Flash Keys

```ruby
InertiaRails.configure do |config|
  config.flash_keys = %i[notice alert success error warning info]
end
```

---

## Confirmation Dialogs

### Reusable Confirm Component

```jsx
// components/ConfirmDialog.tsx
import { useState, useCallback, useRef } from 'react'

interface ConfirmOptions {
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  destructive?: boolean
}

export function useConfirm() {
  const [isOpen, setIsOpen] = useState(false)
  const [options, setOptions] = useState<ConfirmOptions>({})
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions = {}) => {
    setOptions({
      title: 'Are you sure?',
      message: 'This action cannot be undone.',
      confirmText: 'Confirm',
      cancelText: 'Cancel',
      destructive: false,
      ...opts,
    })
    setIsOpen(true)

    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
    })
  }, [])

  function handleConfirm() {
    setIsOpen(false)
    resolveRef.current?.(true)
  }

  function handleCancel() {
    setIsOpen(false)
    resolveRef.current?.(false)
  }

  const ConfirmDialog = isOpen ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleCancel} />
      <div className="relative bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold">{options.title}</h3>
        <p className="mt-2 text-gray-600">{options.message}</p>
        <div className="mt-6 flex gap-3 justify-end">
          <button onClick={handleCancel} className="btn-secondary">
            {options.cancelText}
          </button>
          <button
            onClick={handleConfirm}
            className={options.destructive ? 'btn-danger' : 'btn-primary'}
          >
            {options.confirmText}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { confirm, ConfirmDialog }
}
```

### Usage

```jsx
import { router } from '@inertiajs/react'
import { useConfirm } from '@/components/ConfirmDialog'

export default function UserRow({ user }) {
  const { confirm, ConfirmDialog } = useConfirm()

  async function deleteUser() {
    const confirmed = await confirm({
      title: 'Delete User',
      message: `Are you sure you want to delete ${user.name}?`,
      confirmText: 'Delete',
      destructive: true,
    })

    if (confirmed) {
      router.delete(`/users/${user.id}`)
    }
  }

  return (
    <div>
      <button onClick={deleteUser}>Delete</button>
      {ConfirmDialog}
    </div>
  )
}
```

---

## Handling Rails Validation Error Types

Rails returns different error formats. Handle them consistently:

```ruby
# Controller helper
def format_errors(model)
  model.errors.to_hash.transform_values { |messages| messages.first }
end

# Usage
redirect_to edit_user_url(user), inertia: { errors: format_errors(user) }
```

```javascript
// Frontend - errors are now { field: 'message' } format
form.errors.email  // "can't be blank"
```

### Nested Model Errors

```ruby
# For nested attributes
def format_nested_errors(model)
  errors = {}

  model.errors.each do |error|
    key = error.attribute.to_s.gsub('.', '_')
    errors[key] = error.message
  end

  errors
end
```

---

## Real-Time Features with ActionCable

### Setup Turbo Streams Alternative

```javascript
// channels/notifications_channel.js
import { router } from '@inertiajs/react'
import consumer from './consumer'

consumer.subscriptions.create('NotificationsChannel', {
  received(data) {
    if (data.reload) {
      router.reload({ only: ['notifications'] })
    }
  }
})
```

### Controller Broadcast

```ruby
class NotificationsController < ApplicationController
  def create
    notification = current_user.notifications.create!(notification_params)

    ActionCable.server.broadcast(
      "notifications_#{current_user.id}",
      { reload: true }
    )

    redirect_to notifications_path
  end
end
```

---

## File Downloads

### Triggering Downloads

```ruby
def download
  report = Report.find(params[:id])

  # Return download URL as prop
  render inertia: {
    download_url: rails_blob_path(report.file, disposition: 'attachment')
  }
end
```

```javascript
// Trigger download without navigation
function downloadFile(url) {
  window.location.href = url
}

// Or use inertia_location for non-Inertia responses
router.visit(url, { method: 'get' })
```

### External Redirect for Downloads

```ruby
def export
  # Generate file...
  inertia_location export_download_path(token: token)
end
```
