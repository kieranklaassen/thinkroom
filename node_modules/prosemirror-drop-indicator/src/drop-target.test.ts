import { Slice } from 'prosemirror-model'
import { describe, expect, it, vi } from 'vitest'

import { buildGetTarget } from './drop-target'
import { createTestView } from './test-helpers'
import type { DragEventHandler } from './types'

const point: readonly [number, number] = [16, 16]

describe('buildGetTarget', () => {
  it('memoizes the target for identical points', () => {
    const { view, destroy } = createTestView()
    const onDrag = vi.fn<DragEventHandler>()
    onDrag.mockReturnValue(true)
    const getTarget = buildGetTarget(view, onDrag)
    const event = new DragEvent('dragover', {
      clientX: point[0],
      clientY: point[1],
    })

    const target1 = getTarget(point, event)
    expect(target1).toBeDefined()
    expect(onDrag).toHaveBeenCalledTimes(1)

    const target2 = getTarget(point, event)
    expect(target2).toEqual(target1)
    expect(onDrag).toHaveBeenCalledTimes(1)

    destroy()
  })

  it('skips targets rejected by the onDrag hook', () => {
    const { view, destroy } = createTestView()
    const baseGetTarget = buildGetTarget(view)
    const event = new DragEvent('dragover', {
      clientX: point[0],
      clientY: point[1],
    })
    const firstTarget = baseGetTarget(point, event)
    expect(firstTarget).toBeDefined()

    const blockedPos = firstTarget![0]
    const onDrag = vi.fn<DragEventHandler>(({ pos }) => pos !== blockedPos)
    const getTarget = buildGetTarget(view, onDrag)
    const target = getTarget(point, event)

    expect(target).toBeDefined()
    expect(target![0]).not.toBe(blockedPos)
    expect(onDrag).toHaveBeenCalledTimes(2)

    destroy()
  })

  it('ignores drop targets when dragging onto the same node', () => {
    const { view, destroy } = createTestView({ nodeSelectionPos: 0 })
    view.dragging = {
      slice: Slice.empty,
      move: true,
    }

    const getTarget = buildGetTarget(view)
    const event = new DragEvent('dragover', {
      clientX: point[0],
      clientY: point[1],
    })
    const target = getTarget(point, event)

    expect(target).toBeUndefined()

    // Clean up fake dragging state.
    view.dragging = null
    destroy()
  })
})
