import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import {
  MAX_SKETCH_HEIGHT,
  MIN_SKETCH_HEIGHT,
  normalizeSketchData,
  normalizeSketchScene,
  type SketchData,
  type SketchScene,
} from './scene'

const loadExcalidrawCanvas = () => import('./excalidraw_canvas')
const ExcalidrawCanvas = lazy(loadExcalidrawCanvas)
const SAVE_DELAY_MS = 350

// The Inertia document chunk loads while the collaborative editor connects;
// use that time to fetch the drawing tools instead of waiting for first click.
if (typeof window !== 'undefined') void loadExcalidrawCanvas()

class SketchCanvasBoundary extends Component<
  { children: ReactNode; onDone: () => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Thinkroom sketch canvas failed to load', error, info)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="sketch-load-error" role="alert">
        <strong>The sketch canvas could not load.</strong>
        <span>Your document is still safe. Reload Thinkroom to try again.</span>
        <button type="button" className="sketch-button" onClick={this.props.onDone}>
          Close
        </button>
      </div>
    )
  }
}

interface InlineSketchProps {
  data: SketchData
  wrapper: HTMLElement
  onChange: (data: SketchData) => void
  onDelete: (id: string) => void
  onDone: (focusAfter?: boolean) => void
}

export function InlineSketch({ data, wrapper, onChange, onDelete, onDone }: InlineSketchProps) {
  const [canvasInitialScene] = useState<SketchScene>(data.scene)
  const sceneDraftRef = useRef<unknown>(canvasInitialScene)
  const selectedElementsRef = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [canvasHeight, setCanvasHeight] = useState(data.height)
  const canvasHeightRef = useRef(data.height)
  const [error, setError] = useState('')

  const persist = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
    const scene = normalizeSketchScene(sceneDraftRef.current)
    // The caption lives in the surrounding ProseMirror node view rather than
    // this React portal. Read its live value so clicking away cannot race the
    // caption's blur-save and overwrite a just-typed title with stale props.
    const description = wrapper.querySelector<HTMLInputElement>('.thinkroom-sketch-title')?.value
      ?? data.description
    const next = scene && normalizeSketchData({
      ...data,
      description,
      height: canvasHeightRef.current,
      scene,
    })
    if (!next) {
      setError('This sketch is too large or contains unsupported data.')
      return false
    }
    setError('')
    onChange(next)
    return true
  }, [data, onChange, wrapper])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(persist, SAVE_DELAY_MS)
  }, [persist])

  const updateScene = useCallback((next: unknown) => {
    sceneDraftRef.current = next
    const appState = next && typeof next === 'object' && 'appState' in next
      ? (next as { appState?: unknown }).appState
      : null
    const selectedElementIds = appState && typeof appState === 'object' && 'selectedElementIds' in appState
      ? (appState as { selectedElementIds?: unknown }).selectedElementIds
      : null
    selectedElementsRef.current = selectedElementIds && typeof selectedElementIds === 'object'
      ? Object.keys(selectedElementIds).length
      : 0
    scheduleSave()
  }, [scheduleSave])

  const done = useCallback(() => {
    if (persist()) onDone(true)
  }, [onDone, persist])

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapper.contains(event.target) && persist()) onDone(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') done()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', escape, true)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [done, onDone, persist, wrapper])

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = canvasHeight
    const move = (next: PointerEvent) => {
      const height = Math.min(
        MAX_SKETCH_HEIGHT,
        Math.max(MIN_SKETCH_HEIGHT, startHeight + next.clientY - startY),
      )
      canvasHeightRef.current = height
      setCanvasHeight(height)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      persist()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }

  return (
    <div
      className="thinkroom-sketch-editor"
      aria-label="Inline sketch editor"
      onKeyDownCapture={(event) => {
        if (event.key !== 'Backspace' && event.key !== 'Delete') return
        const target = event.target
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable) ||
          selectedElementsRef.current > 0
        ) return
        event.preventDefault()
        event.stopPropagation()
        onDelete(data.id)
      }}
    >
      <div className="sketch-inline-canvas" style={{ height: canvasHeight }}>
        <SketchCanvasBoundary onDone={() => onDone(true)}>
          <Suspense fallback={<div className="sketch-loading">Loading canvas…</div>}>
            <ExcalidrawCanvas scene={canvasInitialScene} onSceneChange={updateScene} />
          </Suspense>
        </SketchCanvasBoundary>
      </div>
      <div
        className="sketch-resize-handle"
        role="separator"
        aria-label="Resize sketch paper"
        aria-orientation="horizontal"
        aria-valuemin={MIN_SKETCH_HEIGHT}
        aria-valuemax={MAX_SKETCH_HEIGHT}
        aria-valuenow={canvasHeight}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          const height = Math.min(
            MAX_SKETCH_HEIGHT,
            Math.max(MIN_SKETCH_HEIGHT, canvasHeightRef.current + (event.key === 'ArrowDown' ? 40 : -40)),
          )
          canvasHeightRef.current = height
          setCanvasHeight(height)
          scheduleSave()
        }}
      >
        <span />
      </div>
      {error && <p className="sketch-error" role="alert">{error}</p>}
    </div>
  )
}
