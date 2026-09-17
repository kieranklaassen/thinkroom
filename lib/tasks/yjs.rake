# Operator tasks for a document's live Yjs (CRDT) state. In production:
#
#   bin/kamal app exec --reuse 'bin/rails "yjs:compact[SLUG]"'
#   bin/kamal app exec --reuse 'bin/rails "yjs:reset[SLUG]"'
namespace :yjs do
  desc "Fold and re-encode a document's stored Yjs state (content unchanged): yjs:compact[slug]"
  task :compact, [ :slug ] => :environment do |_task, args|
    document = Document.find_by!(slug: args.fetch(:slug))
    result = YjsPersistence.compact!(document)
    puts "yjs:compact #{document.slug} (id #{document.id}): " \
         "#{result[:before_bytes]} -> #{result[:after_bytes]} bytes, #{result[:outcome]}"
  end

  desc "Replace a document's live Yjs state with its saved source (archives the old state, bumps the generation): yjs:reset[slug]"
  task :reset, [ :slug ] => :environment do |_task, args|
    document = Document.find_by!(slug: args.fetch(:slug))
    YjsPersistence.fold!(document)
    document.reload
    before_bytes = document.yjs_state&.bytesize || 0
    # The last accepted snapshot, else the seed; a legacy row with neither
    # gets the default template rather than an empty seed.
    source = document.current_content.presence || document.default_seed

    document.replace_content!(source:)
    Activity.log!(
      document:, actor_name: "Thinkroom", actor_kind: "system",
      action: "reset_document",
      detail: "An operator reset the live document state to its saved source (#{before_bytes} bytes archived)"
    )
    DocumentMetaChannel.broadcast_event(document, :content_reset)

    puts "yjs:reset #{document.slug} (id #{document.id}): archived #{before_bytes} bytes of state, " \
         "generation #{document.content_generation}, seed #{source.to_s.bytesize} bytes"
  end
end
