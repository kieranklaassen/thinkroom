import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { memo, useCallback, useMemo } from 'react'
import type { SketchScene } from './scene'

interface ExcalidrawCanvasProps {
  scene: SketchScene
  onSceneChange: (scene: unknown) => void
}

const UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false,
    saveAsImage: false,
    toggleTheme: false,
  },
  tools: { image: false },
} as const

function ExcalidrawCanvas({ scene, onSceneChange }: ExcalidrawCanvasProps) {
  const initialData = useMemo(
    () => ({
      elements: scene.elements,
      appState: { ...scene.appState, viewBackgroundColor: '#fffef9' },
      files: {},
    }),
    [scene],
  )
  const handleChange = useCallback(
    (elements: Parameters<NonNullable<React.ComponentProps<typeof Excalidraw>['onChange']>>[0],
      appState: Parameters<NonNullable<React.ComponentProps<typeof Excalidraw>['onChange']>>[1],
      files: Parameters<NonNullable<React.ComponentProps<typeof Excalidraw>['onChange']>>[2]) => {
      onSceneChange({ type: 'excalidraw', version: 2, elements, appState, files })
    },
    [onSceneChange],
  )
  return (
    <Excalidraw
      initialData={initialData as never}
      onChange={handleChange}
      UIOptions={UI_OPTIONS}
      aiEnabled={false}
      autoFocus
      handleKeyboardGlobally={false}
      validateEmbeddable={false}
    />
  )
}

export default memo(ExcalidrawCanvas)
