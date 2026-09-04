import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMediaQuery } from '../lib/use_media_query'
import { useDismissable } from '../lib/use_dismissable'

interface Props {
  rootClassName: string
  popoverClassName: string
  popoverLabel: string
  /** Renders the anchor button; wire `toggle` to its click and `open` to
   *  aria-expanded. */
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode
  /** Lets the page react to the popover opening (e.g. suppress selection
   *  chrome while it is above the chrome's z-index). */
  onOpenChange?: (open: boolean) => void
  children: ReactNode | ((actions: { close: () => void }) => ReactNode)
}

/**
 * Header popover mechanics shared by Share and the ⋯ menu: anchored
 * absolute panel, outside-mousedown + Escape to close, and the mobile
 * full-width sheet. The sticky header's backdrop-filter makes it the
 * containing block for fixed descendants — so the mobile sheet must portal
 * to body, behind a tap-to-close backdrop.
 */
export function PopoverShell({
  rootClassName,
  popoverClassName,
  popoverLabel,
  trigger,
  onOpenChange,
  children,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const isMobile = useMediaQuery('(max-width: 48rem)')

  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) rootRef.current?.querySelector('button')?.focus({ preventScroll: true })
  }, [])
  useDismissable(open, (reason) => close(reason === 'escape'), [rootRef, popoverRef])

  useEffect(() => {
    onOpenChange?.(open)
  }, [onOpenChange, open])

  const toggle = useCallback(() => setOpen((v) => !v), [])

  const popover = (
    <div
      className={popoverClassName}
      ref={popoverRef}
      role="dialog"
      aria-label={popoverLabel}
      onClick={(event) => event.stopPropagation()}
    >
      {typeof children === 'function' ? children({ close }) : children}
    </div>
  )

  return (
    <div className={rootClassName} ref={rootRef}>
      {trigger({ open, toggle })}
      {open &&
        (isMobile
          ? createPortal(
              <div className="share-backdrop" onClick={() => setOpen(false)}>
                {popover}
              </div>,
              document.body,
            )
          : popover)}
    </div>
  )
}
