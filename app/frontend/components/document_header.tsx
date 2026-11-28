import type { ComponentProps, ReactNode } from 'react'
import { Link } from '@inertiajs/react'
import { nativeHaptic } from '@ruby-native/react'
import type { UserIdentity } from '../editor/identity'
import type { ConnectionStatus } from '../editor/milkdown_editor'
import { printDocument } from '../editor/document_export'
import type { ThemeName } from '../lib/theme'
import type { AgentPresencePayload, OwnershipPayload } from '../types/payloads'
import type { ViewerPayload } from '../types/viewer'
import { HeaderMenu } from './header_menu'
import { IdentityChip } from './identity_chip'
import { ModeControl, type EditorMode } from './mode_control'
import { PresenceBar, type HumanPresence } from './presence_bar'
import { SharePopover } from './share_popover'
import { ThemeSwitcher } from './theme_picker'
import { VersionUpdateButton } from './version_update_button'

interface Props {
  documentTitle: string
  effectiveMode: EditorMode
  availableModes: EditorMode[]
  modeLocked: boolean
  demoModeLocked: boolean
  onChangeMode: (mode: EditorMode) => void
  status: ConnectionStatus
  newVersionAvailable: boolean
  peers: HumanPresence[]
  presences: AgentPresencePayload[]
  isMobile: boolean
  followingClientId: number | null
  onFollow: (clientId: number) => void
  provenanceSummary: ReactNode
  identity: UserIdentity
  guest: boolean
  viewer: ViewerPayload
  onRenamed: ComponentProps<typeof IdentityChip>['onRenamed']
  /** Offered only for more than one. */
  acceptAllCount: number
  acceptingAll: boolean
  onAcceptAll: () => Promise<void>
  ownership: OwnershipPayload
  exportReady: boolean
  onExportMarkdown: () => Promise<void>
  onExportHtml: () => Promise<void>
  onShareOpenChange: (open: boolean) => void
  theme: ThemeName
  onChangeTheme: (theme: ThemeName) => void
  onThemeOpenChange: (open: boolean) => void
  panelOpen: boolean
  onTogglePanel: () => void
  focusMode: boolean
  onToggleFocus: () => void
  slug: string
}

/** The document page's top bar; hidden in the native shell. */
export function DocumentHeader({
  documentTitle,
  effectiveMode,
  availableModes,
  modeLocked,
  demoModeLocked,
  onChangeMode,
  status,
  newVersionAvailable,
  peers,
  presences,
  isMobile,
  followingClientId,
  onFollow,
  provenanceSummary,
  identity,
  guest,
  viewer,
  onRenamed,
  acceptAllCount,
  acceptingAll,
  onAcceptAll,
  ownership,
  exportReady,
  onExportMarkdown,
  onExportHtml,
  onShareOpenChange,
  theme,
  onChangeTheme,
  onThemeOpenChange,
  panelOpen,
  onTogglePanel,
  focusMode,
  onToggleFocus,
  slug,
}: Props) {
  return (
    <header className="doc-header native-hidden">
      <div className="doc-header-left">
        {/* The nav bar's leading button (-> #native-doc-back) owns back in
            the native shell now that this header hides there; the old
            header back button had no other consumer. */}
        <Link href="/" className="doc-home" aria-label="Home">
          T.
        </Link>
        <span className="doc-title">{documentTitle}</span>
        <ModeControl
          mode={effectiveMode}
          onChange={onChangeMode}
          availableModes={availableModes}
          locked={modeLocked}
          lockedReason={
            modeLocked && !demoModeLocked
              ? 'Can view — the owner limited this link to reading'
              : undefined
          }
        />
        <span
          className={`doc-status doc-status--${status}`}
          title={status === 'live' ? 'Connected — edits sync live' : 'Connecting…'}
        />
        {newVersionAvailable && <VersionUpdateButton className="version-update" />}
      </div>
      <div className="doc-header-right">
        {/* ≤3 groups: presence/identity · Share · ⋯ menu. Presence sits on
            the cluster's open left edge (its reserved lane blends into the
            header's free middle space) and your own identity chip anchors
            the right, next to Share. */}
        <div className="doc-header-people">
          <PresenceBar
            humans={peers}
            agents={presences}
            compact={isMobile}
            followingClientId={followingClientId}
            onFollow={onFollow}
          />
          {provenanceSummary}
          <IdentityChip
            identity={identity}
            guest={guest}
            authenticated={Boolean(viewer.account)}
            onRenamed={onRenamed}
          />
        </div>
        {acceptAllCount > 1 && (
          <button
            className="accept-all-button"
            disabled={acceptingAll}
            onClick={() => void onAcceptAll()}
            {...nativeHaptic('success')}
          >
            {acceptingAll ? 'Accepting…' : `Accept all ${acceptAllCount}`}
          </button>
        )}
        <SharePopover
          agentsActive={presences.length}
          exportReady={exportReady}
          linkAccess={ownership.link_access}
          canChangeAccess={ownership.yours}
          onExportMarkdown={onExportMarkdown}
          onExportHtml={onExportHtml}
          onPrint={printDocument}
          onOpenChange={onShareOpenChange}
        />
        <ThemeSwitcher theme={theme} onChange={onChangeTheme} onOpenChange={onThemeOpenChange} />
        <HeaderMenu
          theme={theme}
          onChangeTheme={onChangeTheme}
          panelOpen={panelOpen}
          onTogglePanel={onTogglePanel}
          focusMode={focusMode}
          onToggleFocus={onToggleFocus}
          slug={slug}
          ownership={ownership}
          claimerName={identity.name}
          account={viewer.account}
          feedbackAutomationEnabled={viewer.feedback_automation_enabled}
        />
      </div>
    </header>
  )
}
