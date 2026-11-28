import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`
const capture = (...names) => stub(names
  .map((name) => `export const ${name} = (props) => { globalThis.documentPageParts['${name}'] = props; return null }`)
  .join('\n'))
globalThis.documentPageParts = {}
const STUBS = {
  '@inertiajs/react': capture('Link'),
  '@ruby-native/react': stub('export const nativeHaptic = () => ({})'),
  '../editor/comment_anchors': stub('export const findCommentAnchorRange = (doc, anchor) => (doc.includes(anchor) ? {} : null)'),
  '../editor/document_export': stub('export const printDocument = () => {}'),
  './header_menu': capture('HeaderMenu'),
  './identity_chip': capture('IdentityChip'),
  './mode_control': capture('ModeControl'),
  './presence_bar': capture('PresenceBar'),
  './share_popover': capture('SharePopover'),
  './theme_picker': capture('ThemeSwitcher'),
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/\/(document_header|comment_recovery)\.tsx$/.test(context.parentURL ?? '')) {
      if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true }
      if (specifier === './version_update_button') return nextResolve(`${specifier}.tsx`, context)
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context)
    const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  },
})

const { CommentRecovery } = await import('../../app/frontend/components/comment_recovery.tsx')
const { VersionUpdateButton } = await import('../../app/frontend/components/version_update_button.tsx')
const { DocumentHeader } = await import('../../app/frontend/components/document_header.tsx')

const DRAFT = { body: 'My draft', anchor: null, message: 'Connection lost.', uncertain: false, previousIds: [], authorName: 'Ada', checkedMissing: false }
const recovery = (draft, props) => renderToStaticMarkup(createElement(CommentRecovery, {
  failedComment: draft && { ...DRAFT, ...draft }, checkingComment: false, commentNotice: null, canComment: true,
  viewRef: { current: { state: { doc: 'quoted text' } } }, ...props,
}))
const button = (html, label) => html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0]

test('a comment that failed keeps its draft and can be retried', () => {
  const html = recovery({})
  assert.match(html, /<section class="comment-recovery" aria-label="Comment status"><p role="alert">Connection lost\.<\/p>/)
  assert.match(html, /<textarea aria-label="Unsent comment" readOnly="">My draft<\/textarea>/)
  assert.equal(button(html, 'Retry comment'), '<button type="button">Retry comment</button>')
  assert.ok(button(html, 'Discard draft'))
  assert.equal(button(html, 'Check saved comments'), undefined)
  assert.doesNotMatch(html, /<blockquote|comment-scope/)
})

test('a quoted comment says so when its text has changed', () => {
  const changed = /Original text changed/
  assert.match(recovery({ anchor: 'quoted' }), /<blockquote class="comment-quote">quoted<\/blockquote>/)
  assert.doesNotMatch(recovery({ anchor: 'quoted' }), changed)
  assert.match(recovery({ anchor: 'gone' }), changed)
  assert.doesNotMatch(recovery({ anchor: 'gone' }, { viewRef: { current: null } }), changed)
})

test('a comment that may be saved is checked before it is retried', () => {
  const unchecked = recovery({ uncertain: true })
  assert.ok(button(unchecked, 'Check saved comments'))
  assert.equal(button(unchecked, 'Retry comment'), undefined)
  assert.equal(button(unchecked, 'Retry anyway'), undefined)
  assert.ok(button(recovery({ uncertain: true, checkedMissing: true }), 'Retry anyway'))
  const checking = recovery({ uncertain: true, checkedMissing: true }, { checkingComment: true })
  assert.match(button(checking, 'Checking…'), /disabled/)
  assert.match(button(checking, 'Retry anyway'), /disabled/)
})

test('without comment access the draft can only be copied or discarded', () => {
  const html = recovery({}, { canComment: false })
  assert.match(button(html, 'Retry comment'), /disabled/)
  assert.doesNotMatch(button(html, 'Discard draft'), /disabled/)
  assert.match(html, /Comment access is no longer available/)
  assert.match(button(recovery({ uncertain: true, checkedMissing: true }, { canComment: false }), 'Retry anyway'), /disabled/)
})

test('a notice alone is a status that can be dismissed', () => {
  const html = recovery(null, { commentNotice: 'Could not confirm.' })
  assert.match(html, /<p role="status">Could not confirm\.<\/p><button type="button">Dismiss<\/button>/)
  assert.doesNotMatch(html, /textarea|role="alert"/)
})

const header = (props) => renderToStaticMarkup(createElement(DocumentHeader, {
  documentTitle: 'My title', effectiveMode: 'edit', availableModes: ['edit', 'read'], modeLocked: false, demoModeLocked: false,
  status: 'live', newVersionAvailable: false, presences: [{}, {}], provenanceSummary: 'summary', identity: { name: 'Ada' },
  viewer: { account: null, feedback_automation_enabled: true }, acceptAllCount: 0, acceptingAll: false,
  ownership: { link_access: 'comment', yours: true }, ...props,
}))

test('the header offers accept-all for more than one suggestion and shows its progress', () => {
  assert.doesNotMatch(header({ acceptAllCount: 1 }), /accept-all-button/)
  assert.match(header({ acceptAllCount: 2 }), /<button class="accept-all-button">Accept all 2<\/button>/)
  assert.match(header({ acceptAllCount: 2, acceptingAll: true }), /<button class="accept-all-button" disabled="">Accepting…<\/button>/)
})

test('the header shows the connection and a newer version', () => {
  assert.match(header({}), /<span class="doc-title">My title<\/span>/)
  assert.match(header({}), /doc-status--live" title="Connected — edits sync live"/)
  assert.match(header({ status: 'connecting' }), /doc-status--connecting" title="Connecting…"/)
  assert.doesNotMatch(header({}), /version-update/)
  assert.match(header({ newVersionAvailable: true }), /<button type="button" class="version-update">New version · Update<\/button>/)
})

test('the update button reloads the page', () => {
  let reloads = 0
  globalThis.window = { location: { reload: () => { reloads += 1 } } }
  VersionUpdateButton({ className: 'version-update' }).props.onClick()
  delete globalThis.window
  assert.equal(reloads, 1)
})

test('the header explains a locked mode only when the owner limited it', () => {
  const reason = (props) => { header(props); return globalThis.documentPageParts.ModeControl.lockedReason }
  assert.equal(reason({}), undefined)
  assert.match(reason({ modeLocked: true }), /owner limited this link/)
  assert.equal(reason({ modeLocked: true, demoModeLocked: true }), undefined)
})

test('the header gives each control its own handlers and state', () => {
  const props = Object.fromEntries([
    'onChangeMode', 'onFollow', 'onRenamed', 'onExportMarkdown', 'onExportHtml', 'onShareOpenChange', 'onChangeTheme',
    'onThemeOpenChange', 'onTogglePanel', 'onToggleFocus',
  ].map((name) => [name, name]))
  assert.match(header({ ...props, exportReady: 'ready', theme: 'proof', panelOpen: 'panel', focusMode: 'focus', slug: 'doc' }), /summary/)
  const parts = globalThis.documentPageParts
  assert.equal(parts.ModeControl.onChange, 'onChangeMode')
  assert.equal(parts.PresenceBar.onFollow, 'onFollow')
  assert.deepEqual([parts.IdentityChip.onRenamed, parts.IdentityChip.authenticated], ['onRenamed', false])
  const { agentsActive, exportReady, linkAccess, canChangeAccess, onExportMarkdown, onExportHtml, onOpenChange } = parts.SharePopover
  assert.deepEqual(
    [agentsActive, exportReady, linkAccess, canChangeAccess, onExportMarkdown, onExportHtml, onOpenChange],
    [2, 'ready', 'comment', true, 'onExportMarkdown', 'onExportHtml', 'onShareOpenChange'],
  )
  assert.deepEqual(parts.ThemeSwitcher, { theme: 'proof', onChange: 'onChangeTheme', onOpenChange: 'onThemeOpenChange' })
  assert.deepEqual(parts.HeaderMenu, {
    theme: 'proof', onChangeTheme: 'onChangeTheme', panelOpen: 'panel', onTogglePanel: 'onTogglePanel', focusMode: 'focus',
    onToggleFocus: 'onToggleFocus', slug: 'doc', ownership: { link_access: 'comment', yours: true }, claimerName: 'Ada',
    account: null, feedbackAutomationEnabled: true,
  })
})
