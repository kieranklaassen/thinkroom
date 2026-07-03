// Local typings for @ruby-native/react (the package ships untyped JS) and
// for the RubyNative global the native shell injects into the web view.
// Only the surface Thinkroom uses is typed; extend as more features land.
// https://rubynative.com/docs/inertia

type NativeHapticFeedback = 'success' | 'warning' | 'error' | 'impact' | 'selection'

declare module '@ruby-native/react' {
  import type { ReactElement, ReactNode } from 'react'

  /** Signal element: shows the native navbar with `title` on this page. */
  export function NativeNavbar(props: {
    title?: string
    pullToRefresh?: boolean
    children?: ReactNode
  }): ReactElement

  /**
   * Native navbar button. `href` navigates; `click` clicks a DOM element by
   * CSS selector. With children (menu items) it becomes a dropdown menu.
   */
  export function NativeButton(props: {
    position?: 'leading' | 'trailing'
    icon?: string
    icons?: { ios?: string; android?: string }
    title?: string
    href?: string
    click?: string
    selected?: boolean
    children?: ReactNode
  }): ReactElement

  /**
   * Dropdown menu entry inside a NativeButton. `href` navigates; `click`
   * clicks a DOM element by CSS selector.
   */
  export function NativeMenuItem(props: {
    title: string
    href?: string
    click?: string
    icon?: string
    icons?: { ios?: string; android?: string }
    selected?: boolean
  }): ReactElement

  /**
   * Floating action button. `icon` is required: on the open web the platform
   * is unknown, so an `icons`-only usage falls back to `icon` and throws when
   * it is absent. `href` navigates; `click` clicks a DOM element by CSS
   * selector.
   */
  export function NativeFab(props: {
    icon: string
    icons?: { ios?: string; android?: string }
    href?: string
    click?: string
  }): ReactElement

  /**
   * Nav-bar share button: opens the platform share sheet. `url` defaults to
   * the current page on the shell side.
   */
  export function NativeShareButton(props: {
    position?: 'leading' | 'trailing'
    title?: string
    icon?: string
    icons?: { ios?: string; android?: string }
    url?: string
  }): ReactElement

  /**
   * Nav-bar submit button for form pages. `click` clicks a DOM element by
   * CSS selector (defaults to [type='submit'] — pass an explicit scoped
   * selector when the page has more than one submit button).
   */
  export function NativeSubmitButton(props: {
    title?: string
    click?: string
  }): ReactElement

  /** Marks the page as a form so native back navigation skips it. */
  export function NativeForm(): ReactElement

  /**
   * Returns `data-native-haptic` attributes to spread onto a clickable
   * element. The shell vibrates when the element is tapped; inert on web.
   */
  export function nativeHaptic(
    feedback?: NativeHapticFeedback,
    data?: Record<string, string>,
  ): Record<string, string>
}

/**
 * Injected by the Ruby Native shell; absent in regular browsers. Always
 * guard access (`window.RubyNative?.`).
 */
interface RubyNativeBridge {
  haptic(feedback?: NativeHapticFeedback): void
  /** Tab-aware navigation: switches tabs when the URL belongs to another tab. */
  visit(url: string): void
  postMessage(message: { action: string } & Record<string, unknown>): void
}

interface Window {
  RubyNative?: RubyNativeBridge
}
