// Local typings for @ruby-native/react (the package ships untyped JS) and
// for the RubyNative global the native shell injects into the web view.
// Only the surface Thinkroom uses is typed; extend as more features land.
// https://rubynative.com/docs/inertia

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
   * CSS selector. With children (NativeMenuItem) it becomes a dropdown menu.
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

  export function NativeMenuItem(props: {
    title: string
    href?: string
    click?: string
    icon?: string
    icons?: { ios?: string; android?: string }
    selected?: boolean
  }): ReactElement

  /** Opens the native share sheet (defaults to the current page URL). */
  export function NativeShareButton(props: {
    position?: 'leading' | 'trailing'
    title?: string
    icon?: string
    icons?: { ios?: string; android?: string }
    url?: string
  }): ReactElement

  /** Marks the page as a form so native back navigation skips it. */
  export function NativeForm(): ReactElement

  /** Signal element: shows the native tab bar (unused while tabs are off). */
  export function NativeTabs(props: { enabled?: boolean }): ReactElement

  /**
   * Returns `data-native-haptic` attributes to spread onto a clickable
   * element. The shell vibrates when the element is tapped; inert on web.
   */
  export function nativeHaptic(
    feedback?: 'success' | 'warning' | 'error' | 'impact' | 'selection',
    data?: Record<string, string>,
  ): Record<string, string>
}

/**
 * Injected by the Ruby Native shell; absent in regular browsers. Always
 * guard access (`window.RubyNative?.`).
 */
interface RubyNativeBridge {
  haptic(feedback?: 'success' | 'warning' | 'error' | 'impact' | 'selection'): void
  /** Tab-aware navigation: switches tabs when the URL belongs to another tab. */
  visit(url: string): void
  postMessage(message: { action: string } & Record<string, unknown>): void
}

interface Window {
  RubyNative?: RubyNativeBridge
}
