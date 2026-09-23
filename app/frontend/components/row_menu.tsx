import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDismissable } from '../lib/use_dismissable'

export interface RowMenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
}

interface Props {
  label: string
  /** Viewport coordinates: the pointer for a right-click, the trigger's corner otherwise. */
  x: number
  y: number
  items: RowMenuItem[]
  onClose: (restoreFocus: boolean) => void
}

const MENU_WIDTH = 208

/**
 * A document row's action menu, opened by right-click or the row's ⋯ button.
 * Portaled to <body> with fixed positioning so it escapes the notebook page's
 * clipping; keeps inside the viewport; arrow keys move between items, Escape
 * or an outside press closes it.
 */
export function RowMenu({ label, x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  useDismissable(true, (reason) => onClose(reason === 'escape'), [menuRef])

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [])

  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8))
  const top = Math.max(8, Math.min(y, window.innerHeight - items.length * 40 - 24))

  return createPortal(
    <div
      ref={menuRef}
      className="row-menu"
      role="menu"
      aria-label={label}
      style={{ left, top, width: MENU_WIDTH }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        let next: number
        switch (event.key) {
          case 'ArrowDown': next = (index + 1) % buttons.length; break
          case 'ArrowUp': next = (index - 1 + buttons.length) % buttons.length; break
          case 'Home': next = 0; break
          case 'End': next = buttons.length - 1; break
          case 'Tab': onClose(false); return
          default: return
        }
        event.preventDefault()
        buttons[next]?.focus()
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`row-menu-item${item.danger ? ' is-danger' : ''}`}
          onClick={() => {
            onClose(false)
            item.onSelect()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
