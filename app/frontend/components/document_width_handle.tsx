import { useLayoutEffect, useRef, useState } from 'react'

export const MIN_DOCUMENT_WIDTH = 576
export const MAX_DOCUMENT_WIDTH = 1120

interface Props {
  width: number | null
  onChange: (width: number) => void
  onCommit: (width: number) => void
  onReset: () => void
}

interface DragState {
  pointerId: number
  startX: number
  startWidth: number
  maxWidth: number
}

const clampWidth = (width: number, maxWidth = MAX_DOCUMENT_WIDTH) =>
  Math.round(Math.min(Math.max(width, MIN_DOCUMENT_WIDTH), maxWidth))

/** The desktop document edge: drag it, or use arrows, to resize the prose. */
export function DocumentWidthHandle({ width, onChange, onCommit, onReset }: Props) {
  const handleRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const lastWidthRef = useRef<number | null>(width)
  const [measuredWidth, setMeasuredWidth] = useState(MIN_DOCUMENT_WIDTH)
  const [dragging, setDragging] = useState(false)
  lastWidthRef.current = width

  const documentElement = () =>
    handleRef.current?.previousElementSibling instanceof HTMLElement
      ? handleRef.current.previousElementSibling
      : null

  // A saved preference can be wider than the space available on this screen.
  // Start interactions from the visible edge, not the off-screen preference,
  // so the first ArrowLeft or leftward drag always moves immediately.
  const currentWidth = () => documentElement()?.getBoundingClientRect().width ?? width ?? measuredWidth

  const usableMaxWidth = () => {
    const body = handleRef.current?.closest('.doc-body')
    if (!(body instanceof HTMLElement)) return MAX_DOCUMENT_WIDTH

    const rail = body.querySelector('.doc-rail')
    const gutter = handleRef.current?.nextElementSibling
    const railWidth = rail instanceof HTMLElement && getComputedStyle(rail).display !== 'none'
      ? rail.getBoundingClientRect().width
      : 0
    const gutterWidth = gutter instanceof HTMLElement
      ? gutter.getBoundingClientRect().width
      : 0

    return Math.max(
      MIN_DOCUMENT_WIDTH,
      Math.min(MAX_DOCUMENT_WIDTH, body.getBoundingClientRect().width - railWidth - gutterWidth),
    )
  }

  useLayoutEffect(() => {
    const documentMain = documentElement()
    if (!documentMain || typeof ResizeObserver === 'undefined') return

    const update = () => setMeasuredWidth(Math.round(documentMain.getBoundingClientRect().width))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(documentMain)
    return () => observer.disconnect()
  }, [])

  const finishDrag = (pointerId: number) => {
    if (dragRef.current?.pointerId !== pointerId) return
    dragRef.current = null
    setDragging(false)
    if (lastWidthRef.current !== null) onCommit(lastWidthRef.current)
  }

  const displayedWidth = Math.round(measuredWidth)

  return (
    <div
      ref={handleRef}
      className={`document-width-handle ${dragging ? 'is-dragging' : ''}`}
      role="separator"
      aria-label="Document width"
      aria-orientation="vertical"
      aria-valuemin={MIN_DOCUMENT_WIDTH}
      aria-valuemax={MAX_DOCUMENT_WIDTH}
      aria-valuenow={displayedWidth}
      aria-valuetext={`${displayedWidth} pixels. Press Home or double-click to reset.`}
      tabIndex={0}
      title="Drag to resize · Arrow keys adjust · Double-click resets"
      onDoubleClick={(event) => {
        event.preventDefault()
        onReset()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Home') {
          event.preventDefault()
          onReset()
          return
        }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

        event.preventDefault()
        const direction = event.key === 'ArrowRight' ? 1 : -1
        const step = event.shiftKey ? 64 : 16
        const nextWidth = clampWidth(currentWidth() + direction * step, usableMaxWidth())
        lastWidthRef.current = nextWidth
        onChange(nextWidth)
        onCommit(nextWidth)
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: currentWidth(),
          maxWidth: usableMaxWidth(),
        }
        setDragging(true)
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        const nextWidth = clampWidth(drag.startWidth + event.clientX - drag.startX, drag.maxWidth)
        lastWidthRef.current = nextWidth
        onChange(nextWidth)
      }}
      onPointerUp={(event) => finishDrag(event.pointerId)}
      onPointerCancel={(event) => finishDrag(event.pointerId)}
    >
      <span aria-hidden>•••</span>
    </div>
  )
}
