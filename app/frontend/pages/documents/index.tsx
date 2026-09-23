import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Head, Link, router, useForm } from '@inertiajs/react'
import { NativeNavbar, NativeButton, NativeMenuItem, NativeFab, nativeHaptic } from '@ruby-native/react'
import { FeedbackButton } from '../../components/feedback_button'
import { AccountControl } from '../../components/account_control'
import { BackgroundPicker, type IndexBackground } from '../../components/background_picker'
import { SwipeRow } from '../../components/swipe_row'
import { userIdentity } from '../../editor/identity'
import { setCookie } from '../../lib/cookies'
import { useClaim } from '../../lib/use_claim'
import { useIsClient } from '../../lib/use_is_client'
import { usePin, type PinnableDocument } from '../../lib/use_pin'
import { useWebmcpTools } from '../../lib/use_webmcp_tools'
import { executeManifestTool } from '../../lib/webmcp_execute'
import { errorResult, type WebmcpManifest } from '../../lib/webmcp'
import type { OwnershipPayload } from '../../types/payloads'
import type { SharedProps } from '../../types'
import type { ViewerPayload } from '../../types/viewer'

type AgeGroup = 'this_week' | 'earlier'
type DayPart = 'morning' | 'afternoon' | 'evening'

type DocLink = {
  title: string
  slug: string
  tags: string[]
  created_at: string
  created_label: string
  age_group: AgeGroup
}

type RecentDoc = DocLink & OwnershipPayload
type PinnedDoc = RecentDoc & { pinned_at: string }

type Props = Pick<SharedProps, 'nativeApp'> & {
  yours: DocLink[]
  yours_count: number
  recent: RecentDoc[]
  pinned: PinnedDoc[]
  continue_reading: RecentDoc | null
  today_label: string
  day_part: DayPart
  ui: { background: IndexBackground }
  viewer: ViewerPayload
  // WebMCP tool manifest (AgentGuide.webmcp_index_tools) — lazy prop.
  webmcp: WebmcpManifest
}

// The index has no document, so the guide's viewer context is the viewer only.
const INDEX_VIEWER_CONTEXT_NOTE =
  'This is the human viewer of the documents index. You act as an anonymous agent; created documents start unclaimed.'

const EARLIER_PREVIEW_LIMIT = 8
const CONTENTS_WINDOW = 50
const GITHUB_REPOSITORY_URL = 'https://github.com/kieranklaassen/thinkroom'
const GITHUB_PROFILE_URL = 'https://github.com/kieranklaassen'
// Every list that shows a star or a Pinned row reloads together, so star
// state (derived from `pinned`) and Pinned meta never drift apart.
const LIST_PROPS = ['pinned', 'yours', 'yours_count', 'recent', 'continue_reading', 'errors']

const errorText = (error: unknown): string | null => {
  if (Array.isArray(error)) return error.find((value) => typeof value === 'string') ?? null
  return typeof error === 'string' ? error : null
}

const pluralPages = (count: number) => (count === 1 ? '1 page' : `${count} pages`)

function PinStar({
  title,
  pinned,
  pending,
  onToggle,
  buttonRef,
}: {
  title: string
  pinned: boolean
  pending: boolean
  onToggle: () => void
  buttonRef?: (button: HTMLButtonElement | null) => void
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`pin-star${pinned ? ' is-pinned' : ''}${pending ? ' is-pending' : ''}`}
      aria-pressed={pinned}
      aria-busy={pending || undefined}
      aria-label={`${pinned ? 'Unpin' : 'Pin'} ${title}`}
      title={pinned ? 'Unpin' : 'Pin'}
      onClick={onToggle}
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path
          d="M8 1.5l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 10.9 4.3 13l.8-4.2L2 5.9l4.2-.5L8 1.5z"
          fill={pinned ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

function ClaimButton({ slug, claimerName }: { slug: string; claimerName: string }) {
  const { claim, claiming, claimFailed } = useClaim(slug, claimerName, { only: LIST_PROPS })

  return (
    <button
      className="notebook-claim"
      type="button"
      disabled={claiming}
      title={claimFailed ? 'Claim failed — try again' : 'Make this document yours'}
      onClick={claim}
    >
      {claiming ? 'Claiming…' : claimFailed ? 'Try again' : 'Claim'}
    </button>
  )
}

function TagEditor({ document, onClose }: { document: DocLink; onClose: () => void }) {
  const form = useForm(`DocumentTags:${document.slug}`, {
    tags: document.tags.join(', '),
  })
  const tagError = errorText(form.errors.tags)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    form.transform((data) => ({
      tags: data.tags.split(',').map((tag) => tag.trim()),
    }))
    form.patch(`/d/${document.slug}/tags`, {
      preserveScroll: true,
      only: LIST_PROPS,
      onSuccess: onClose,
    })
  }

  return (
    <form className="document-tag-editor" onSubmit={submit}>
      <label htmlFor={`tags-${document.slug}`}>Tags</label>
      <div className="document-tag-editor-controls">
        <input
          id={`tags-${document.slug}`}
          value={form.data.tags}
          onChange={(event) => form.setData('tags', event.target.value)}
          placeholder="Research, planning"
          autoFocus
          aria-describedby={`tags-help-${document.slug}`}
          aria-invalid={Boolean(tagError)}
        />
        <button className="document-tag-save" type="submit" disabled={form.processing}>
          {form.processing ? 'Saving…' : 'Save'}
        </button>
        <button
          className="document-tag-cancel"
          type="button"
          onClick={() => {
            form.clearErrors()
            onClose()
          }}
        >
          Cancel
        </button>
      </div>
      <p id={`tags-help-${document.slug}`} className="document-tag-help">
        Up to 8 tags, 32 characters each. Separate with commas.
      </p>
      {tagError && (
        <p className="document-tag-error" role="alert">
          {tagError}
        </p>
      )}
    </form>
  )
}

function ContentsRow({
  document,
  pinned,
  pending,
  onTogglePin,
  swipe,
}: {
  document: DocLink
  pinned: boolean
  pending: boolean
  onTogglePin: () => void
  swipe?: { deleting: boolean; onDelete: () => void; closeSignal: number }
}) {
  const [editingTags, setEditingTags] = useState(false)

  const body = (
    <>
      <div className="contents-row-line">
        <PinStar title={document.title} pinned={pinned} pending={pending} onToggle={onTogglePin} />
        <Link className="document-row-title" href={`/d/${document.slug}`} prefetch>
          {document.title}
        </Link>
        <button
          className="document-tag-edit"
          type="button"
          aria-expanded={editingTags}
          onClick={() => setEditingTags((open) => !open)}
        >
          {document.tags.length > 0 ? 'Edit tags' : '+ Add tag'}
        </button>
        <span className="contents-leader" aria-hidden="true" />
        <time className="contents-date" dateTime={document.created_at}>
          {document.created_label}
        </time>
      </div>
      {document.tags.length > 0 && (
        <div className="contents-row-meta">
          {document.tags.map((tag) => (
            <span className="document-tag" key={tag.toLowerCase()}>
              {tag}
            </span>
          ))}
        </div>
      )}
      {editingTags && <TagEditor document={document} onClose={() => setEditingTags(false)} />}
    </>
  )

  if (swipe) {
    return (
      <li className="contents-row contents-row--swipe">
        <SwipeRow
          slug={document.slug}
          deleting={swipe.deleting}
          onDelete={swipe.onDelete}
          closeSignal={swipe.closeSignal}
        >
          <div className="swipe-row-padding">{body}</div>
        </SwipeRow>
      </li>
    )
  }

  return <li className="contents-row">{body}</li>
}

const pinnedMeta = (document: PinnedDoc) => {
  if (!document.yours && document.owner_name) return `Owned by ${document.owner_name}`
  if (document.tags.length > 0) return document.tags.join(', ')
  return `Created ${document.created_label}`
}

export default function DocumentsIndex({
  yours,
  yours_count,
  recent,
  pinned,
  continue_reading,
  today_label,
  day_part,
  ui,
  viewer,
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
  const [background, setBackground] = useState<IndexBackground>(ui.background)
  const changeBackground = useCallback((next: IndexBackground) => {
    setBackground(next)
    setCookie('pruf_background', next)
  }, [])

  const [origin, setOrigin] = useState('')
  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])
  // Server-rendered labels, the THIS WEEK grouping, the date line and the
  // greeting follow the viewer's timezone through this cookie (same
  // server-readable pattern as width/panel prefs). The first-ever visit
  // renders in the app default once.
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone) setCookie('pruf_tz', zone)
  }, [])

  // --- Copy agent prompt: copy on click; reveal the text when the clipboard
  // refuses (permissions policy, native web view) so it can be copied by hand.
  const agentInstruction =
    `Create a Thinkroom document for me: POST ${origin}/api/docs with JSON ` +
    `{"title": "…", "format": "markdown", "content": "# …"} ` +
    `or use "format": "html" with HTML content, plus an X-Agent-Name header. ` +
    `The response includes the share URL — open it and we'll collaborate live. ` +
    `Fetch the share URL (Accept: text/plain) for the full API guide.`
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'refused'>('idle')
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const copyInstruction = useCallback(() => {
    clearTimeout(copyTimer.current)
    const refused = () => setCopyState('refused')
    try {
      void navigator.clipboard.writeText(agentInstruction).then(() => {
        setCopyState('copied')
        copyTimer.current = setTimeout(() => setCopyState('idle'), 2400)
      }, refused)
    } catch {
      refused()
    }
  }, [agentInstruction])
  useEffect(() => () => clearTimeout(copyTimer.current), [])

  // --- Pins: every star reads from `pinned`.
  const { toggle: togglePin, pending: pendingPins, error: pinError } = usePin(LIST_PROPS)
  const pinnedSlugs = new Set(pinned.map((document) => document.slug))
  const [announcement, setAnnouncement] = useState('')
  const pinnedHeadingRef = useRef<HTMLHeadingElement>(null)
  const pinnedStarRefs = useRef(new Map<string, HTMLButtonElement>())
  const [focusAfterUnpin, setFocusAfterUnpin] = useState<string | null>(null)
  useEffect(() => {
    if (focusAfterUnpin === null) return
    const target =
      focusAfterUnpin === '' ? pinnedHeadingRef.current : pinnedStarRefs.current.get(focusAfterUnpin)
    target?.focus({ preventScroll: true })
    setFocusAfterUnpin(null)
  }, [focusAfterUnpin, pinned])

  const setPin = (document: PinnableDocument, isPinned: boolean) => {
    if (togglePin(document, isPinned)) {
      setAnnouncement(`${isPinned ? 'Unpinned' : 'Pinned'} ${document.title}`)
    }
  }
  const unpinFromPinned = (document: PinnedDoc, index: number) => {
    const next = pinned[index + 1] ?? pinned[index - 1]
    if (togglePin(document, true)) {
      setAnnouncement(`Unpinned ${document.title}`)
      setFocusAfterUnpin(next ? next.slug : '')
    }
  }

  // --- Contents filters: tag and search combine (AND).
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showAllEarlier, setShowAllEarlier] = useState(false)
  const availableTags = yours.reduce<string[]>((tags, document) => {
    document.tags.forEach((tag) => {
      if (!tags.some((existingTag) => existingTag.toLowerCase() === tag.toLowerCase())) {
        tags.push(tag)
      }
    })
    return tags
  }, [])
  const activeTag = availableTags.includes(selectedTag ?? '') ? selectedTag : null
  const needle = query.trim().toLowerCase()
  const filterActive = activeTag !== null || needle !== ''
  const visibleDocuments = yours.filter((document) => {
    if (activeTag && !document.tags.some((tag) => tag.toLowerCase() === activeTag.toLowerCase())) {
      return false
    }
    if (!needle) return true
    return (
      document.title.toLowerCase().includes(needle) ||
      document.tags.some((tag) => tag.toLowerCase().includes(needle))
    )
  })
  const thisWeek = visibleDocuments.filter((document) => document.age_group === 'this_week')
  const earlier = visibleDocuments.filter((document) => document.age_group === 'earlier')
  const visibleEarlier =
    showAllEarlier || filterActive ? earlier : earlier.slice(0, EARLIER_PREVIEW_LIMIT)
  const hiddenEarlierCount = earlier.length - visibleEarlier.length
  const clearFilters = () => {
    setSelectedTag(null)
    setQuery('')
  }

  // On a phone the Contents page sits below the left page: bring its heading
  // into view when a filter changes so results are never off-screen.
  const contentsHeadingRef = useRef<HTMLHeadingElement>(null)
  const filtersTouched = useRef(false)
  useEffect(() => {
    if (!filtersTouched.current) return
    if (window.matchMedia('(max-width: 56rem)').matches) {
      contentsHeadingRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }, [activeTag, needle])
  const touchFilters = () => {
    filtersTouched.current = true
  }

  const claimerName = identityName
  const hasDemo = recent.some((document) => document.slug === 'demo')
  // Continue reading already shows the newest recent; Shared with you skips it.
  const shared = recent.filter((document) => document.slug !== continue_reading?.slug)
  const firstName = (viewer.account?.name ?? viewer.name ?? '').trim().split(/\s+/)[0]
  const greeting = `Good ${day_part}${firstName ? `, ${firstName}` : ''}.`

  // Native-only swipe-to-delete on owned rows. The server re-checks ownership;
  // this is just the affordance. WKWebView shows confirm() as a native alert.
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Bumped on failure so every SwipeRow snaps closed (per R6, the error
  // message shouldn't sit next to a still-armed Delete).
  const [swipeCloseSignal, setSwipeCloseSignal] = useState(0)
  const deleteDocument = useCallback((slug: string) => {
    if (!window.confirm('Delete this document? This can’t be undone.')) return
    setDeleteError(null)
    router.delete(`/d/${slug}`, {
      preserveScroll: true,
      onStart: () => setDeletingSlug(slug),
      onFinish: () => setDeletingSlug(null),
      onError: (errors) => {
        const message = typeof errors.document === 'string' ? errors.document : null
        setDeleteError(message ?? 'Delete failed — please try again')
        setSwipeCloseSignal((signal) => signal + 1)
      },
    })
  }, [])

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
              <button
                id="new-document-button"
                className="btn btn-primary"
                type="button"
                disabled={processing}
                onClick={() => post('/documents')}
                {...nativeHaptic('impact')}
              >
                {processing ? 'Creating…' : 'New page'}
              </button>
              <button
                id="agent-start-trigger"
                className="notebook-text-button"
                type="button"
                aria-controls={copyState === 'refused' ? 'agent-start-instructions' : undefined}
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
                    onClick={() => setShowAllEarlier(true)}
                  >
                    Turn the page, {hiddenEarlierCount} more
                  </button>
                )}
              </div>
            )}
            {yours.length > 0 && (
              <p className="contents-footer">
                {pluralPages(yours_count)}
                {yours_count > yours.length && ` · showing the newest ${yours.length}`}
              </p>
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
