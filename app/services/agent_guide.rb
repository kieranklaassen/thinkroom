# One URL, two audiences: a browser opening a share link gets the editor; an
# agent fetching the same URL programmatically gets this guide — everything it
# needs to participate, with no special knowledge beyond the link itself.
class AgentGuide
  class << self
    # The full machine-readable state payload (shared by the API and the
    # share URL's JSON representation — same document, same truth).
    def state(document, base_url)
      {
        slug: document.slug,
        title: document.title,
        share_url: "#{base_url}/d/#{document.slug}",
        markdown: document.content_markdown.presence || document.seed_markdown,
        plain_markdown: document.plain_markdown.presence || document.seed_markdown,
        provenance: {
          spans: document.provenance_spans,
          summary: document.provenance_summary
        },
        pending_suggestions: document.suggestions.pending.order(:created_at).map(&:as_props),
        open_comments: document.comments.open.order(:created_at).map(&:as_props),
        agents_present: document.agent_presences.active.map(&:as_props),
        recent_activity: document.activities.recent.map(&:as_props),
        api: endpoints(document, base_url),
        notes: notes
      }
    end

    def endpoints(document, base_url)
      api_base = "#{base_url}/api/docs/#{document.slug}"
      {
        state: { method: "GET", url: api_base,
                 purpose: "Full live document state: markdown, provenance spans, pending suggestions, open comments, presence, activity." },
        propose_suggestion: { method: "POST", url: "#{api_base}/suggestions",
                              body: { body: "(required) markdown you propose", intent: "(optional) one-line summary",
                                      anchor_text: "(optional) existing doc text to insert after",
                                      replaces: "(optional) existing doc text your proposal replaces" },
                              purpose: "Propose an edit. It appears live in every open editor as a pending suggestion attributed to you. A human accepts or rejects it; accepted text keeps your provenance." },
        comment: { method: "POST", url: "#{api_base}/comments",
                   body: { body: "(required) what you want to say", anchor_text: "(optional) the doc text you're commenting on" },
                   purpose: "Leave a comment anchored to a text selection." },
        announce_presence: { method: "POST", url: "#{api_base}/presence",
                             body: { status: "active | done", location: "(optional) doc text you're working near" },
                             purpose: "Show up in the document's presence area with a labeled cursor while you work. Send status: done when finished." },
        poll_events: { method: "GET", url: "#{api_base}/events/pending",
                       purpose: "Activity since your last ack (humans accepting your suggestions, comments, etc.)." },
        ack_events: { method: "POST", url: "#{api_base}/events/ack",
                      body: { last_event_id: "(required) the ack_with value from poll_events" },
                      purpose: "Advance your event cursor." },
        create_document: { method: "POST", url: "#{base_url}/api/docs",
                           body: { title: "(optional)", markdown: "(optional) initial markdown — defaults to a blank template" },
                           purpose: "Create a new shared document; returns its slug and share URL." }
      }
    end

    def notes
      [
        "Identity: send an X-Agent-Name header on every request. That name flows through everything — suggestion attribution, provenance marks when your text is accepted, the presence area, and the activity feed.",
        "All your writes go through the same provenance/suggestion machinery as the human UI. There is no side channel: you propose, humans review.",
        "Text you contribute is marked kind=agent provenance and tinted in the editor until a human advances its review state (pending -> reviewed -> endorsed).",
        "Connected editors see your suggestions, comments, and presence live over WebSocket — no refresh needed on their side.",
        "Reading state: use plain_markdown as your working context for proposals; markdown embeds provenance span HTML. Both reflect the last snapshot pushed by a connected editor and may lag if no human has the document open — the Yjs CRDT state is always authoritative.",
        "Review is human-gated by design: accepting/rejecting suggestions and advancing review states happen in the editor, by humans. Your job is to propose well."
      ]
    end

    # The plain-text variant, embedded invisibly in the editor HTML and served
    # directly to non-browser fetchers of the share URL.
    def text(document, base_url)
      api_base = "#{base_url}/api/docs/#{document.slug}"
      <<~GUIDE
        # #{document.title} — agent guide

        You are an agent reading a Pruf share link. Humans see a live
        collaborative editor at this URL; you participate over plain HTTP.
        Everything you do appears live in their editors, attributed to you.

        ## Identity (required for writes)
        Send your display name in an X-Agent-Name header on every request.
        It becomes your identity in presence, provenance, and the activity feed.

        ## Participate

        1. Announce yourself (a labeled cursor appears in the editor):
           curl -X POST #{api_base}/presence \\
             -H "X-Agent-Name: YOUR_NAME" -H "Content-Type: application/json" \\
             -d '{"status": "active", "location": "text you are working near"}'

        2. Read the full document state (markdown, provenance spans, pending
           suggestions, open comments, presence, recent activity):
           curl #{api_base} -H "X-Agent-Name: YOUR_NAME"

        3. Propose an edit (lands as a pending suggestion humans accept/reject;
           accepted text keeps your provenance, tinted until reviewed):
           curl -X POST #{api_base}/suggestions \\
             -H "X-Agent-Name: YOUR_NAME" -H "Content-Type: application/json" \\
             -d '{"body": "Your proposed markdown.", "intent": "Tighten the intro", "anchor_text": "existing text to insert after"}'
           Use "replaces" instead of "anchor_text" to propose replacing text.

        4. Comment on a selection:
           curl -X POST #{api_base}/comments \\
             -H "X-Agent-Name: YOUR_NAME" -H "Content-Type: application/json" \\
             -d '{"body": "Consider a source here.", "anchor_text": "the text you mean"}'

        5. React to humans (poll + ack):
           curl #{api_base}/events/pending -H "X-Agent-Name: YOUR_NAME"
           curl -X POST #{api_base}/events/ack \\
             -H "X-Agent-Name: YOUR_NAME" -H "Content-Type: application/json" \\
             -d '{"last_event_id": 123}'

        6. Sign off when done:
           curl -X POST #{api_base}/presence \\
             -H "X-Agent-Name: YOUR_NAME" -H "Content-Type: application/json" \\
             -d '{"status": "done"}'

        ## Create your own document
           curl -X POST #{base_url}/api/docs \\
             -H "X-Agent-Name: YOUR_NAME" -H "Content-Type: application/json" \\
             -d '{"title": "My doc", "markdown": "# Hello"}'

        Machine-readable version of this guide: GET #{api_base} (JSON).
      GUIDE
    end
  end
end
