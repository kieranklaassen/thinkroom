# The documents a viewer's home page lists, as row props. Every method runs
# only the queries its own list needs, and lists that share a query share its
# result, so the page can ask for any subset on a partial reload.
class HomeDocuments
  # What a row and its ownership state read. The rest of a document row (both
  # sources, the editor state, provenance) is megabytes a list never shows.
  COLUMNS = %i[
    id title slug tags created_at owner_name owner_token user_id link_access
  ].freeze
  LIST_LIMIT = 50

  # `now` carries the viewer's timezone: date labels and the THIS WEEK bucket
  # follow it.
  def initialize(user:, token:, recent_slugs:, now:)
    @user = user
    @token = token
    @recent_slugs = recent_slugs
    @now = now
    @week_start = now.beginning_of_week
  end

  def yours
    unarchived.select(*COLUMNS).order(created_at: :desc).limit(LIST_LIMIT).map { |document| row(document) }
  end

  def yours_count = counts.then { |all, archived| all - archived }

  def archived_count = counts.last

  def archived
    owned.where.not(archived_at: nil).select(*COLUMNS).order(archived_at: :desc).limit(LIST_LIMIT)
         .map { |document| row(document) }
  end

  # Recent rows ("Shared with you") are documents opened here that the
  # viewer does not own — filtered by ownership, not the LIST_LIMIT window,
  # so an older owned page never shows up as shared. Rows carry ownership
  # state so claimable docs can offer an inline claim affordance.
  # Render-time staleness is fine: the claim POST is race-tolerant and the
  # scoped reload reconciles the lists.
  def recent
    @recent_slugs.filter_map { |slug| recent_by_slug[slug] }
                 .reject { |document| document.owned_by?(@token, user: @user) }
                 .map { |document| row_with_ownership(document) }
  end

  # Pins are their own query so an old pinned doc outside the newest
  # LIST_LIMIT still shows. The cap keeps this list complete, so the page
  # derives every star's state from it.
  def pinned
    pins = DocumentPin.for_owner(user: @user, token: @token)
                      .order(created_at: :desc, id: :desc)
                      .limit(DocumentPin::MAX_PER_OWNER)
    pinned_at = DocumentPin.type_for_attribute(:created_at)
    Document.where(archived_at: nil)
            .joins(:document_pins).merge(pins)
            .select(*COLUMNS, "document_pins.created_at AS pinned_at")
            .map { |document| row_with_ownership(document).merge(pinned_at: pinned_at.deserialize(document[:pinned_at]).iso8601) }
  end

  # The newest recent that still exists, owned or not.
  def continue_reading
    document = @recent_slugs.lazy.filter_map { |slug| recent_by_slug[slug] }.first
    document && row_with_ownership(document)
  end

  private

  # Signed-in ownership follows the account across browsers. Guests retain
  # the original permanent-cookie ownership model.
  def owned
    @user ? Document.where(user_id: @user.id) : Document.where(owner_token: @token)
  end

  # Archived pages leave Contents and Pinned; they stay readable by link and
  # are listed on demand under Archived.
  def unarchived = owned.where(archived_at: nil)

  # One scan answers both counts: every page, then those with archived_at set.
  def counts
    @counts ||= owned.pick(Arel.sql("COUNT(*)"), Arel.sql("COUNT(archived_at)"))
  end

  def recent_by_slug
    @recent_by_slug ||= Document.where(slug: @recent_slugs).select(*COLUMNS).index_by(&:slug)
  end

  def row_with_ownership(document)
    row(document).merge(document.ownership_props(
      @token, viewer_user: @user, editable: document.writable_by?(@token, user: @user)
    ))
  end

  def row(document)
    created_at = document.created_at.in_time_zone(@now.time_zone)
    {
      title: document.title,
      slug: document.slug,
      tags: document.tags,
      created_at: created_at.iso8601,
      created_label: created_at.strftime(created_at.year == @now.year ? "%b %-d" : "%b %-d, %Y"),
      age_group: created_at >= @week_start ? "this_week" : "earlier"
    }
  end
end
