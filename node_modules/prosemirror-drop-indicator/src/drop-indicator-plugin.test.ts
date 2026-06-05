import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDropIndicatorPlugin } from './drop-indicator-plugin'
import { createTestView } from './test-helpers'
import type { ShowHandler } from './types'

const dragPoint = { x: 24, y: 4 }

describe('createDropIndicatorPlugin', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls onShow with the computed line when dragging over the view', () => {
    const onShow = vi.fn<ShowHandler>()
    const plugin = createDropIndicatorPlugin({ onShow })
    const { view, destroy } = createTestView({ plugins: [plugin] })

    const dragOver = new DragEvent('dragover', {
      clientX: dragPoint.x,
      clientY: dragPoint.y,
    })
    view.dom.dispatchEvent(dragOver)

    expect(onShow).toHaveBeenCalledTimes(1)
    const [[{ pos, line }]] = onShow.mock.calls
    expect(typeof pos).toBe('number')
    expect(line.p1).toMatchObject({ x: 0, y: 0 })
    expect(line.p2).toMatchObject({ x: 320, y: 0 })

    destroy()
  })

  it('does not emit duplicate onShow callbacks for identical coordinates', () => {
    const onShow = vi.fn<ShowHandler>()
    const plugin = createDropIndicatorPlugin({ onShow })
    const { view, destroy } = createTestView({ plugins: [plugin] })

    const dragOver = () =>
      view.dom.dispatchEvent(
        new DragEvent('dragover', {
          clientX: dragPoint.x,
          clientY: dragPoint.y,
        }),
      )

    dragOver()
    dragOver()

    expect(onShow).toHaveBeenCalledTimes(1)
    destroy()
  })

  it('delays and triggers onHide after dragleave', () => {
    vi.useFakeTimers()
    const onHide = vi.fn<VoidFunction>()
    const plugin = createDropIndicatorPlugin({ onHide })
    const { view, destroy } = createTestView({ plugins: [plugin] })

    view.dom.dispatchEvent(new DragEvent('dragleave'))
    expect(onHide).not.toHaveBeenCalled()

    vi.advanceTimersByTime(31)
    expect(onHide).toHaveBeenCalledTimes(1)

    destroy()
  })
})
