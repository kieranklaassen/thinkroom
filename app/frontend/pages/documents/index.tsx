import { useCallback, useEffect, useState } from 'react'
import { Head, Link, router, useForm } from '@inertiajs/react'
import { NativeNavbar, NativeButton, NativeMenuItem, NativeFab, nativeHaptic } from '@ruby-native/react'
import { FeedbackButton } from '../../components/feedback_button'
import { AccountControl } from '../../components/account_control'
import { BackgroundPicker, type IndexBackground } from '../../components/background_picker'
import { ContentsRow } from '../../components/contents_row'
import { PinStar } from '../../components/pin_star'
import { userIdentity } from '../../editor/identity'
import { setCookie } from '../../lib/cookies'
import { useClaim } from '../../lib/use_claim'
import { useIsClient } from '../../lib/use_is_client'
import { useNotReady } from '../../lib/use_not_ready'
import { useWebmcpTools } from '../../lib/use_webmcp_tools'
import { executeManifestTool } from '../../lib/webmcp_execute'
import { errorResult, type WebmcpManifest } from '../../lib/webmcp'
import type { SharedProps } from '../../types'
import type { ViewerPayload } from '../../types/viewer'
import { LIST_PROPS, type DocLink, type PinnedDoc, type RecentDoc } from './document_lists'
import { useAgentPrompt } from './use_agent_prompt'
import { useContentsFilters } from './use_contents_filters'
import { useDocumentActions } from './use_document_actions'
import { usePinnedList } from './use_pinned_list'

type DayPart = 'morning' | 'afternoon' | 'evening'

type Props = Pick<SharedProps, 'nativeApp'> & {
  yours: DocLink[]
  yours_count: number
  archived_count: number
  // Optional prop: loaded only when the reader opens Archived.
  archived?: DocLink[]
  recent: RecentDoc[]
  pinned: PinnedDoc[]
  continue_reading: RecentDoc | null
  today_label: string
  day_part: DayPart
  ui: { background: IndexBackground }
  viewer: ViewerPayload
  csrf_token: string
  // WebMCP tool manifest (AgentGuide.webmcp_index_tools) — lazy prop.
  webmcp: WebmcpManifest
}

// The index has no document, so the guide's viewer context is the viewer only.
const INDEX_VIEWER_CONTEXT_NOTE =
  'This is the human viewer of the documents index. You act as an anonymous agent; created documents start unclaimed.'

const CONTENTS_WINDOW = 50
const GITHUB_REPOSITORY_URL = 'https://github.com/kieranklaassen/thinkroom'
const GITHUB_PROFILE_URL = 'https://github.com/kieranklaassen'

const pluralPages = (count: number) => (count === 1 ? '1 page' : `${count} pages`)

function ClaimButton({ slug, claimerName }: { slug: string; claimerName: string }) {
  const { claim, claiming, claimFailed } = useClaim(slug, claimerName, { only: LIST_PROPS })
  const notReady = useNotReady()

  return (
    <button
      className="notebook-claim"
      type="button"
      disabled={claiming}
      title={claimFailed ? 'Claim failed — try again' : 'Make this document yours'}
      {...notReady}
      onClick={claim}
    >
      {claiming ? 'Claiming…' : claimFailed ? 'Try again' : 'Claim'}
    </button>
  )
}

const pinnedMeta = (document: PinnedDoc) => {
  if (!document.yours && document.owner_name) return `Owned by ${document.owner_name}`
  if (document.tags.length > 0) return document.tags.join(', ')
  return `Created ${document.created_label}`
}

export default function DocumentsIndex({
  yours,
  yours_count,
  archived_count,
  archived,
  recent,
  pinned,
  continue_reading,
  today_label,
  day_part,
  ui,
  viewer,
  csrf_token,
  webmcp,
  nativeApp,
}: Props) {
  const [identityName] = useState(() => userIdentity(viewer.name).name)
  // WebMCP: the index registers its two tools once (KTD5); the page component
  // is remounted on every cross-page Inertia visit, so cleanup unregisters.
  useWebmcpTools({
    key: 'index',
    tools: webmcp.tools,
    execute: (tool, args, signal) => {
      // The index has no editor; the server never lists editor tools here.
      if (tool.kind === 'editor') {
        return Promise.resolve(
          errorResult({ error: `${tool.name} is only available on a document page` }),
        )
      }
      return executeManifestTool(tool, args, {
        signal,
        viewerContext: {
          viewer: { name: viewer.name, guest: viewer.guest },
          note: INDEX_VIEWER_CONTEXT_NOTE,
        },
      })
    },
  })
  const { post, processing } = useForm(() => ({
    name: identityName,
  }))
  const isClient = useIsClient()
  const notReady = useNotReady()
  // The choice lives in the page props (and so the history entry), not local
  // state, so Back navigation restores the current background.
  const background = ui.background
  const changeBackground = useCallback((next: IndexBackground) => {
    setCookie('pruf_background', next)
    router.replaceProp('ui.background', next)
  }, [])

  // Server-rendered labels, the THIS WEEK grouping, the date line and the
  // greeting follow the viewer's timezone through this cookie (same
  // server-readable pattern as width/panel prefs). The first-ever visit
  // renders in the app default once.
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone) setCookie('pruf_tz', zone)
  }, [])

  const { agentInstruction, copyState, copyInstruction } = useAgentPrompt()
  const {
    pinnedSlugs,
    pendingPins,
    pinError,
    announcement,
    pinnedHeadingRef,
    pinnedStarRefs,
    setPin,
    unpinFromPinned,
  } = usePinnedList(pinned)
  const {
    searchRef,
    contentsHeadingRef,
    query,
    setQuery,
    setSelectedTag,
    setShowAllEarlier,
    availableTags,
    activeTag,
    needle,
    filterActive,
    visibleDocuments,
    thisWeek,
    visibleEarlier,
    hiddenEarlierCount,
    clearFilters,
    touchFilters,
  } = useContentsFilters(yours)

  const claimerName = identityName
  const hasDemo = recent.some((document) => document.slug === 'demo')
  // Continue reading already shows the newest recent; Shared with you skips it.
  const shared = recent.filter((document) => document.slug !== continue_reading?.slug)
  const firstName = (viewer.account?.name ?? viewer.name ?? '').trim().split(/\s+/)[0]
  const greeting = `Good ${day_part}${firstName ? `, ${firstName}` : ''}.`

  const {
    deletingSlug,
    deleteError,
    swipeCloseSignal,
    deleteDocument,
    showArchived,
    toggleArchived,
    notice,
    setNotice,
    setArchived,
  } = useDocumentActions()

  const contentsGroup = (title: string, documents: DocLink[]) => {
    if (documents.length === 0) return null
    const headingId = `contents-${title.toLowerCase().replace(/\s+/g, '-')}`
    return (
      <section className="contents-group" aria-labelledby={headingId}>
        <h3 id={headingId}>{title}</h3>
        <ul className="contents-list">
          {documents.map((document) => (
            <ContentsRow
              key={document.slug}
              document={document}
              pinned={pinnedSlugs.has(document.slug)}
              pending={pendingPins.has(document.slug)}
              onTogglePin={() => setPin(document, pinnedSlugs.has(document.slug))}
              onArchive={() => setArchived(document, true)}
              onDelete={() => deleteDocument(document.slug)}
              swipe={
                nativeApp
                  ? {
                      deleting: deletingSlug === document.slug,
                      onDelete: () => deleteDocument(document.slug),
                      closeSignal: swipeCloseSignal,
                    }
                  : undefined
              }
            />
          ))}
        </ul>
      </section>
    )
  }

  return (
    <>
      <Head title="Thinkroom" />
      {/* Ruby Native chrome: hidden signal elements the iOS/Android shell
          reads. Menu items and the plus button click or navigate to existing
          web controls so every native action reuses the web submission path. */}
      <NativeNavbar title="Thinkroom">
        <NativeButton position="leading" icon="person.crop.circle">
          {viewer.account ? (
            <NativeMenuItem title="Sign out" click="#account-signout" />
          ) : (
            <NativeMenuItem title="Sign in" href="/login?return_to=%2F" />
          )}
        </NativeButton>
        <NativeButton position="trailing" icon="ellipsis.circle">
          <NativeMenuItem title="Copy agent prompt" click="#agent-start-trigger" />
          {hasDemo && <NativeMenuItem title="Open the demo" href="/d/demo" />}
          {isClient && <NativeMenuItem title="Send feedback" click=".feedback-button button" />}
        </NativeButton>
      </NativeNavbar>
      {/* Floating action button, sibling of the navbar (its own signal
          element). While a create is in flight the only feedback is the
          New page button's disabled "Creating…" state; repeat taps are no-ops. */}
      <NativeFab icon="plus" click="#new-document-button" />
      <div className="landing notebook" data-background={background}>
        <header className="notebook-bar">
          {/* native-hidden: the native nav bar already says Thinkroom, so the
              wordmark would read twice inside the app. */}
          <p className="landing-wordmark native-hidden">
            <Link href="/" className="landing-wordmark-link">
              Thinkroom
            </Link>
          </p>
          <div className="notebook-bar-tools">
            <BackgroundPicker value={background} onChange={changeBackground} />
            <label className="notebook-search">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder="Search your pages"
                aria-label="Search your pages"
                onChange={(event) => {
                  touchFilters()
                  setQuery(event.target.value)
                }}
              />
            </label>
            <div className="notebook-account">
              <AccountControl viewer={viewer} />
              {isClient && (
                <FeedbackButton automationEnabled={viewer.feedback_automation_enabled} />
              )}
            </div>
          </div>
        </header>

        <main className="notebook-spread">
          <section className="notebook-page notebook-page--left" aria-labelledby="notebook-greeting">
            <p className="notebook-date">{today_label}</p>
            <h1 id="notebook-greeting" className="notebook-greeting">
              {greeting}
            </h1>
            <div className="notebook-actions">
              {/* A real form: the button is server rendered, so it can be
                  clicked before hydration, when only the browser can act. */}
              <form
                action="/documents"
                method="post"
                onSubmit={(event) => {
                  event.preventDefault()
                  post('/documents')
                }}
              >
                <input type="hidden" name="authenticity_token" value={csrf_token} />
                <input type="hidden" name="name" value={viewer.name ?? viewer.guest_name ?? ''} />
                <button
                  id="new-document-button"
                  className="btn btn-primary"
                  type="submit"
                  disabled={processing}
                  {...nativeHaptic('impact')}
                >
                  {processing ? 'Creating…' : 'New page'}
                </button>
              </form>
              <button
                id="agent-start-trigger"
                className="notebook-text-button"
                type="button"
                aria-controls={copyState === 'refused' ? 'agent-start-instructions' : undefined}
                {...notReady}
                onClick={copyInstruction}
              >
                {copyState === 'copied' ? 'Copied' : 'Copy agent prompt'}
              </button>
            </div>
            <p className="notebook-sr-only" aria-live="polite">
              {copyState === 'copied' ? 'Agent prompt copied to clipboard' : ''}
            </p>
            {copyState === 'refused' && (
              <div id="agent-start-instructions" className="landing-agent-block">
                <p className="landing-agent-hint">
                  Your browser blocked copying. Paste this to any agent that can make HTTP requests:
                </p>
                <code>{agentInstruction}</code>
              </div>
            )}

            <section className="notebook-section" aria-labelledby="pinned-heading">
              <h2 id="pinned-heading" className="notebook-label" tabIndex={-1} ref={pinnedHeadingRef}>
                Pinned
              </h2>
              {pinError && (
                <p className="document-tag-error" role="alert">
                  {pinError}
                </p>
              )}
              {pinned.length === 0 ? (
                <p className="notebook-hint">Star any page in Contents to keep it here.</p>
              ) : (
                <ul className="pinned-list">
                  {pinned.map((document, index) => (
                    <li className="pinned-row" key={document.slug}>
                      <PinStar
                        title={document.title}
                        pinned
                        pending={pendingPins.has(document.slug)}
                        onToggle={() => unpinFromPinned(document, index)}
                        buttonRef={(button) => {
                          if (button) pinnedStarRefs.current.set(document.slug, button)
                          else pinnedStarRefs.current.delete(document.slug)
                        }}
                      />
                      <Link className="pinned-title" href={`/d/${document.slug}`} prefetch>
                        <span>{document.title}</span>
                        <span className="pinned-meta">{pinnedMeta(document)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {continue_reading && (
              <section className="notebook-section" aria-labelledby="continue-heading">
                <h2 id="continue-heading" className="notebook-label">
                  Continue reading
                </h2>
                <Link className="continue-card" href={`/d/${continue_reading.slug}`} prefetch>
                  <span className="continue-title">{continue_reading.title}</span>
                  <span className="continue-meta">
                    {continue_reading.yours || !continue_reading.owner_name
                      ? `Created ${continue_reading.created_label}`
                      : `Owned by ${continue_reading.owner_name}`}
                  </span>
                </Link>
              </section>
            )}

            {shared.length > 0 && (
              <section className="notebook-section" aria-labelledby="shared-heading">
                <h2 id="shared-heading" className="notebook-label">
                  Shared with you
                </h2>
                <ul className="shared-list">
                  {shared.map((document) => (
                    <li className="shared-row" key={document.slug}>
                      <PinStar
                        title={document.title}
                        pinned={pinnedSlugs.has(document.slug)}
                        pending={pendingPins.has(document.slug)}
                        onToggle={() => setPin(document, pinnedSlugs.has(document.slug))}
                      />
                      <Link className="shared-title" href={`/d/${document.slug}`} prefetch>
                        {document.title}
                      </Link>
                      {document.claimable ? (
                        <ClaimButton slug={document.slug} claimerName={claimerName} />
                      ) : (
                        document.owner_name && <span className="shared-owner">{document.owner_name}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="notebook-folio" aria-hidden="true">
              i
            </p>
          </section>

          <section className="notebook-page notebook-page--right" aria-labelledby="contents-heading">
            <div className="contents-heading">
              <h2 id="contents-heading" ref={contentsHeadingRef}>
                Contents
              </h2>
              {availableTags.length > 0 && (
                <div className="contents-filters" aria-label="Filter pages by tag">
                  <button
                    type="button"
                    aria-pressed={activeTag === null}
                    {...notReady}
                    onClick={() => {
                      touchFilters()
                      setSelectedTag(null)
                    }}
                  >
                    All
                  </button>
                  {availableTags.map((tag) => (
                    <button
                      type="button"
                      key={tag.toLowerCase()}
                      aria-pressed={activeTag === tag}
                      {...notReady}
                      onClick={() => {
                        touchFilters()
                        setSelectedTag(tag)
                      }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="notebook-sr-only" aria-live="polite">
              {filterActive ? `${pluralPages(visibleDocuments.length)} match` : ''}
            </p>
            {filterActive && needle && yours_count > CONTENTS_WINDOW && (
              <p className="notebook-hint">
                Searching your newest {CONTENTS_WINDOW} of {yours_count} pages.
              </p>
            )}

            {/* Above the list branches: a failed delete re-scopes the props,
                and the message must survive whatever the list becomes. */}
            {deleteError && (
              <p className="document-delete-error" role="alert">
                {deleteError}
              </p>
            )}
            <div className="contents-notice" role="status">
              {notice && (
                <>
                  <span>{notice.text}</span>
                  {notice.undo && (
                    <button
                      className="notebook-text-button"
                      type="button"
                      onClick={() => {
                        const undo = notice.undo
                        setNotice(null)
                        undo?.()
                      }}
                    >
                      Undo
                    </button>
                  )}
                </>
              )}
            </div>
            {yours.length === 0 ? (
              <p className="notebook-hint notebook-empty">
                Your pages will be listed here. Start with New page, or copy the agent prompt and let
                an agent write the first draft.
              </p>
            ) : visibleDocuments.length === 0 ? (
              <div className="notebook-empty">
                <p className="notebook-hint">No pages match.</p>
                <button className="notebook-text-button" type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="contents-groups">
                {contentsGroup('This week', thisWeek)}
                {contentsGroup('Earlier', visibleEarlier)}
                {hiddenEarlierCount > 0 && (
                  <button
                    className="document-reveal"
                    type="button"
                    {...notReady}
                    onClick={() => setShowAllEarlier(true)}
                  >
                    Turn the page, {hiddenEarlierCount} more
                  </button>
                )}
              </div>
            )}
            {(yours.length > 0 || archived_count > 0) && (
              <div className="contents-footer">
                <span>
                  {pluralPages(yours_count)}
                  {yours_count > yours.length && ` · showing the newest ${yours.length}`}
                </span>
                {archived_count > 0 && (
                  <button
                    className="contents-archived-toggle"
                    type="button"
                    aria-expanded={showArchived}
                    aria-controls="archived-pages"
                    {...notReady}
                    onClick={toggleArchived}
                  >
                    Archived ({archived_count})
                  </button>
                )}
              </div>
            )}
            {showArchived && archived_count > 0 && (
              <section id="archived-pages" className="contents-group" aria-labelledby="archived-heading">
                <h3 id="archived-heading">Archived</h3>
                {archived === undefined ? (
                  <p className="notebook-hint">Loading…</p>
                ) : (
                  <ul className="contents-list">
                    {archived.map((document) => (
                      <li className="contents-row archived-row" key={document.slug}>
                        <div className="contents-row-line">
                          <Link className="document-row-title" href={`/d/${document.slug}`} prefetch>
                            {document.title}
                          </Link>
                          <span className="contents-leader" aria-hidden="true" />
                          <button
                            className="notebook-text-button archived-action"
                            type="button"
                            aria-label={`Restore ${document.title}`}
                            onClick={() => setArchived(document, false)}
                          >
                            Restore
                          </button>
                          <button
                            className="notebook-text-button archived-action is-danger"
                            type="button"
                            aria-label={`Delete ${document.title}`}
                            onClick={() => deleteDocument(document.slug)}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            <p className="notebook-folio" aria-hidden="true">
              ii
            </p>
          </section>
        </main>

        <p className="notebook-sr-only" aria-live="polite">
          {announcement}
        </p>

        <footer className="landing-footer">
          {hasDemo && (
            <Link href="/d/demo" className="landing-demo-link" prefetch>
              Open the demo
            </Link>
          )}
          <a
            className="landing-github"
            href={GITHUB_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 2C6.48 2 2 6.58 2 12.22c0 4.5 2.87 8.32 6.84 9.67.5.1.68-.22.68-.49v-1.91c-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.05 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.35 9.35 0 0 1 12 6.61c.85 0 1.7.12 2.5.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.92-2.34 4.78-4.57 5.04.36.32.68.94.68 1.89v3.11c0 .27.18.59.69.49A10.24 10.24 0 0 0 22 12.22C22 6.58 17.52 2 12 2Z"
              />
            </svg>
            <span>Open source on GitHub</span>
            <span className="landing-github-star" aria-hidden="true">★</span>
          </a>
          <p>
            Made with love <span aria-label="love">❤️</span> in Southern California by{' '}
            <a href={GITHUB_PROFILE_URL} target="_blank" rel="noreferrer">
              Kieran Klaassen
            </a>
          </p>
        </footer>
      </div>
    </>
  )
}
