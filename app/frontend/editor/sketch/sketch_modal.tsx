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
  EMPTY_SKETCH_SCENE,
  MAX_SKETCH_DESCRIPTION,
  normalizeSketchData,
  normalizeSketchScene,
  type SketchData,
  type SketchScene,
} from './scene'
import { copySketchSvg, downloadSketchSvg } from './export'

const ExcalidrawCanvas = lazy(() => import('./excalidraw_canvas'))

class SketchCanvasBoundary extends Component<
  { children: ReactNode; onClose: () => void },
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
        <span>Your document is still safe. Close this window and reload Thinkroom to try again.</span>
        <button type="button" className="sketch-button" onClick={this.props.onClose}>
          Close
        </button>
      </div>
    )
  }
}

interface SketchModalProps {
  initialData?: SketchData | null
  onCancel: () => void
  onDelete?: () => void
  onSave: (data: SketchData) => void
}

export function SketchModal({ initialData, onCancel, onDelete, onSave }: SketchModalProps) {
  const [canvasInitialScene] = useState<SketchScene>(initialData?.scene ?? EMPTY_SKETCH_SCENE)
  const sceneDraftRef = useRef<unknown>(canvasInitialScene)
  const [description, setDescription] = useState(initialData?.description ?? '')
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    document.body.classList.add('sketch-modal-open')
    dialogRef.current?.focus()
    return () => {
      document.body.classList.remove('sketch-modal-open')
      previous?.focus()
    }
  }, [])

  const updateScene = useCallback((next: unknown) => {
    sceneDraftRef.current = next
  }, [])

  const save = () => {
    const scene = normalizeSketchScene(sceneDraftRef.current)
    if (!scene) {
      setError('This sketch is too large or contains unsupported image or link data.')
      return
    }
    const data = normalizeSketchData({
      id: initialData?.id ?? crypto.randomUUID(),
      formatVersion: 1,
      description,
      scene,
    })
    if (!data) {
      setError('This sketch is too large to save in the document.')
      return
    }
    onSave(data)
  }

  const runExport = async (action: (scene: SketchScene) => Promise<void>) => {
    const scene = normalizeSketchScene(sceneDraftRef.current)
    if (!scene) {
      setError('This sketch is too large or contains unsupported image or link data.')
      return
    }
    setExporting(true)
    setError('')
    try {
      await action(scene)
    } catch {
      setError('The SVG could not be exported. Try saving the sketch first.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="sketch-modal-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="sketch-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sketch-modal-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
          if (event.key === 'Tab') {
            const focusable = Array.from(
              dialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
              ) ?? [],
            ).filter((element) => element.offsetParent !== null)
            const first = focusable[0]
            const last = focusable[focusable.length - 1]
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <header className="sketch-modal-header">
          <div>
            <h2 id="sketch-modal-title">{initialData ? 'Edit sketch' : 'New sketch'}</h2>
            <p>Draw with mouse, touch, or Apple Pencil.</p>
          </div>
          <div className="sketch-modal-actions">
            {initialData && onDelete && (
              <button type="button" className="sketch-button sketch-button-danger" onClick={onDelete}>
                Delete
              </button>
            )}
            <button type="button" className="sketch-button" onClick={onCancel}>Cancel</button>
            <button type="button" className="sketch-button sketch-button-primary" onClick={save}>Save sketch</button>
          </div>
        </header>

        <div className="sketch-canvas-shell">
          <SketchCanvasBoundary onClose={onCancel}>
            <Suspense fallback={<div className="sketch-loading">Loading canvas…</div>}>
              <ExcalidrawCanvas scene={canvasInitialScene} onSceneChange={updateScene} />
            </Suspense>
          </SketchCanvasBoundary>
        </div>

        <footer className="sketch-modal-footer">
          <label className="sketch-description">
            <span>Description for people and agents</span>
            <input
              type="text"
              value={description}
              maxLength={MAX_SKETCH_DESCRIPTION}
              placeholder="e.g. Signup approval flow"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="sketch-modal-footer-actions">
            <button
              type="button"
              className="sketch-button"
              disabled={exporting}
              onClick={() => void runExport(copySketchSvg)}
            >
              Copy SVG
            </button>
            <button
              type="button"
              className="sketch-button"
              disabled={exporting}
              onClick={() => void runExport((scene) => downloadSketchSvg(scene, description))}
            >
              Download SVG
            </button>
          </div>
          {error && <p className="sketch-error" role="alert">{error}</p>}
        </footer>
      </div>
    </div>
  )
}
