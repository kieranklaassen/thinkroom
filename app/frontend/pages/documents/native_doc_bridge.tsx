import {
  NativeNavbar,
  NativeButton,
  NativeMenuItem,
  NativeShareButton,
} from '@ruby-native/react'
import type { EditorMode } from '../../components/mode_control'

interface Props {
  documentTitle: string
  availableModes: EditorMode[]
  effectiveMode: EditorMode
  modeLocked: boolean
  isReading: boolean
  changeMode: (mode: EditorMode) => void
  onToggleActivity: () => void
  onOpenTheme: () => void
  /** The export helpers throw before the live editor handle exists; the web
   *  UI disables its export buttons the same way (SharePopover's
   *  exportReady). A pre-ready tap is a silent no-op. */
  exportReady: boolean
  onExportMarkdown: () => Promise<void>
  onExportHtml: () => Promise<void>
}

/**
 * Ruby Native chrome: the shell reads hidden signal elements. The nav bar
 * replaces the web doc-header inside the app (hidden there via
 * native-hidden); every action delegates to the bridge strip so targets are
 * always mounted and never display:none.
 */
export function NativeDocBridge({
  documentTitle,
  availableModes,
  effectiveMode,
  modeLocked,
  isReading,
  changeMode,
  onToggleActivity,
  onOpenTheme,
  exportReady,
  onExportMarkdown,
  onExportHtml,
}: Props) {
  return (
    <>
      <NativeNavbar title={documentTitle}>
        <NativeButton position="leading" icon="chevron.left" click="#native-doc-back" />
        <NativeShareButton />
        <NativeButton position="trailing" icon="ellipsis.circle">
          {!modeLocked &&
            availableModes.map((menuMode) => (
              <NativeMenuItem
                key={menuMode}
                title={menuMode.charAt(0).toUpperCase() + menuMode.slice(1)}
                selected={effectiveMode === menuMode}
                click={`#native-mode-${menuMode}`}
              />
            ))}
          {!isReading && <NativeMenuItem title="Activity" click="#native-toggle-activity" />}
          <NativeMenuItem title="Appearance" click="#native-theme-open" />
          <NativeMenuItem title="Export Markdown" click="#native-export-markdown" />
          <NativeMenuItem title="Export HTML" click="#native-export-html" />
          <NativeMenuItem title="Home" href="/" />
        </NativeButton>
      </NativeNavbar>
      {/* Bridge strip: clip-hidden (never display:none — the shell's click
          dispatch mechanism is unspecified, and coordinate-based synthesis
          needs a real box). Handlers call the live setters directly. */}
      <div className="native-bridge" aria-hidden="true">
        <button
          id="native-doc-back"
          type="button"
          tabIndex={-1}
          onClick={() => window.RubyNative?.postMessage({ action: 'back' })}
        >
          Back
        </button>
        {availableModes.map((bridgeMode) => (
          <button
            key={bridgeMode}
            id={`native-mode-${bridgeMode}`}
            type="button"
            tabIndex={-1}
            onClick={() => changeMode(bridgeMode)}
          >
            {bridgeMode}
          </button>
        ))}
        {/* Activity is omitted from the native menu in Read mode and its sheet
            only renders outside Read; a stale-menu tap during Read is a no-op
            so activeSheet can't be set with nothing visible. */}
        <button
          id="native-toggle-activity"
          type="button"
          tabIndex={-1}
          onClick={() => {
            if (!isReading) onToggleActivity()
          }}
        >
          Activity
        </button>
        <button
          id="native-theme-open"
          type="button"
          tabIndex={-1}
          onClick={onOpenTheme}
        >
          Appearance
        </button>
        <button
          id="native-export-markdown"
          type="button"
          tabIndex={-1}
          onClick={() => {
            if (exportReady) void onExportMarkdown()
          }}
        >
          Export Markdown
        </button>
        <button
          id="native-export-html"
          type="button"
          tabIndex={-1}
          onClick={() => {
            if (exportReady) void onExportHtml()
          }}
        >
          Export HTML
        </button>
      </div>
    </>
  )
}
