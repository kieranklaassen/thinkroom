# Cold-path durability, recovery, archival, checksum verification, and
# operator-driven compaction for Yjs document state. Kept separate from
# YjsPersistence so the hot append/read/fold path stays focused and small.
class YjsRecovery
  # A fold archives the pre-fold state at most this often per document,
  # bounding what a corrupt-blob heal can lose to one interval of edits.
  CHECKPOINT_INTERVAL = 10.minutes

  # A retained (pending) log row whose causal dependency never arrives is an
  # orphan: after this long it is quarantined to yjs_state_archives instead
  # of being refolded forever or silently dropped.
  ORPHAN_TTL = 1.hour

  class << self
    # Operator-driven rewrite of the stored state (rake yjs:compact): fold
    # any tail, load the blob into a fresh doc (healing a corrupt one), and
    # re-encode it with deleted content garbage-collected. The re-encoding
    # is persisted only when it is smaller — yrs does not lay out an equal
    # state byte-identically across processes, so byte equality cannot be
    # the no-op test — and the pre-compaction blob is kept as a checkpoint
    # archive so the rewrite is recoverable. A blob missing its vector or
    # checksum (legacy row) is stamped in place. Content never changes: the
    # re-encoded doc is the same CRDT. A second run reports "unchanged".
    # A corrupt blob is healed by the load (quarantined, checkpoint restored
    # or emptied) and reported as "healed" without further rewriting.
    #
    # => { before_bytes:, after_bytes:, changed:, outcome: }
    def compact!(document)
      ActiveSupport::Notifications.instrument("compact.yjs", document_id: document.id) do |payload|
        YjsPersistence.with_document_lock(document) do
          YjsPersistence.perform_fold(document) if document.yjs_document_updates.exists?

          original_state = document.yjs_state
          original_checksum = document.yjs_state_checksum
          stored_bytes = original_state.to_s.bytesize
          if stored_bytes.zero?
            payload[:outcome] = "empty"
            next { before_bytes: 0, after_bytes: 0, changed: false, outcome: "empty" }
          end

          ydoc = YjsPersistence.load_or_heal_ydoc(document)
          # A corrupt blob was quarantined and a checkpoint restored (or the
          # document emptied, or a stale checksum restamped) by the load;
          # report that rather than compacting or stamping the restored state.
          healed = document.yjs_state != original_state || document.yjs_state_checksum != original_checksum
          before = document.yjs_state.to_s
          blob = ydoc.compacted_state_update
          result = { before_bytes: stored_bytes, after_bytes: before.bytesize, changed: false }
          payload[:before_bytes] = stored_bytes
          payload[:after_bytes] = result[:after_bytes]

          outcome =
            if healed
              "healed"
            elsif blob.bytesize < before.bytesize && YjsPersistence.blob_loadable?(blob)
              result[:after_bytes] = blob.bytesize
              YjsStateArchive.record!(document, kind: YjsStateArchive::CHECKPOINT)
              document.update_columns(
                yjs_state: blob,
                yjs_state_vector: ydoc.encode_state_vector,
                yjs_state_checksum: state_checksum(blob),
                updated_at: Time.current
              )
              "compacted"
            elsif document.yjs_state_vector.blank? || document.yjs_state_checksum.blank?
              document.update_columns(
                yjs_state_vector: ydoc.encode_state_vector,
                yjs_state_checksum: state_checksum(before),
                updated_at: Time.current
              )
              "stamped"
            else
              "unchanged"
            end

          payload[:outcome] = outcome
          result.merge(changed: outcome != "unchanged", outcome:)
        end
      end
    end

    # Contain-and-restore for a corrupt stored blob. Callers must hold both
    # the per-document mutex and the row lock. The corrupt bytes are
    # quarantined for forensics, then the newest loadable checkpoint from
    # the *current* content generation is restored — never an older
    # generation, which would resurrect content a replacement wiped. With
    # no restorable checkpoint the document degrades to empty and connected
    # clients re-upload their state through the sync-reply handshake.
    def heal_corrupt_state!(document, error)
      ActiveSupport::Notifications.instrument("recovered.yjs", document_id: document.id) do |payload|
        # A loadable blob with a mismatched checksum is not corruption — it
        # is a write from a pre-checksum code version (mixed-version deploy
        # window or rollback). Re-stamp instead of destroying healthy state.
        if document.yjs_state.present? && YjsPersistence.blob_loadable?(document.yjs_state)
          document.update_columns(
            yjs_state_checksum: state_checksum(document.yjs_state),
            updated_at: Time.current
          )
          payload[:restored_from] = "restamped"
          payload[:outcome] = "recovered"
          return
        end

        YjsStateArchive.record!(document, kind: YjsStateArchive::QUARANTINE, error: error.message)

        checkpoint = document.yjs_state_archives
                             .where(kind: YjsStateArchive::CHECKPOINT, content_generation: document.content_generation)
                             .order(created_at: :desc, id: :desc)
                             .detect { |archive| archive.yjs_state.present? && YjsPersistence.blob_loadable?(archive.yjs_state) }
        if checkpoint
          document.update_columns(
            yjs_state: checkpoint.yjs_state,
            yjs_state_vector: checkpoint.yjs_state_vector,
            yjs_state_checksum: state_checksum(checkpoint.yjs_state),
            updated_at: Time.current
          )
          payload[:restored_from] = "checkpoint"
        else
          document.update_columns(
            yjs_state: nil,
            yjs_state_vector: nil,
            yjs_state_checksum: nil,
            updated_at: Time.current
          )
          payload[:restored_from] = "empty"
        end
        payload[:outcome] = "recovered"
      end
    end

    # Interval-gated archive of the pre-fold state, bounding what a future
    # heal can lose to at most one interval of edits. Caller holds both locks.
    def maybe_checkpoint(document)
      return if document.yjs_state.blank?

      newest = document.yjs_state_archives
                       .where(kind: YjsStateArchive::CHECKPOINT, content_generation: document.content_generation)
                       .maximum(:created_at)
      return if newest && newest > CHECKPOINT_INTERVAL.ago

      YjsStateArchive.record!(document, kind: YjsStateArchive::CHECKPOINT)
    end

    # Immediately quarantine update-log rows whose bytes yrs cannot decode.
    # Valid causally-pending updates park cleanly in yrs without raising, so
    # a StandardError from apply_update means permanently malformed bytes
    # that will never integrate no matter how long they wait.
    def quarantine_poison_pills(document, undecodable)
      return if undecodable.empty?

      undecodable.each do |row, error|
        document.yjs_state_archives.create!(
          kind: YjsStateArchive::QUARANTINE,
          content_generation: row.content_generation,
          yjs_state: row.payload,
          error: "undecodable update row #{row.id}: #{error.class}: #{error.message}"
        )
      end
      YjsStateArchive.prune!(document, YjsStateArchive::QUARANTINE)
      document.yjs_document_updates.where(id: undecodable.map { |row, _| row.id }).delete_all
    end

    def quarantine_orphans(document, retained)
      orphans = retained.select { |row| row.created_at < ORPHAN_TTL.ago }
      return if orphans.empty?

      orphans.each do |row|
        document.yjs_state_archives.create!(
          kind: YjsStateArchive::ORPHAN,
          content_generation: row.content_generation,
          yjs_state: row.payload,
          error: "orphaned pending update: causal dependency never arrived"
        )
      end
      YjsStateArchive.prune!(document, YjsStateArchive::ORPHAN)
      orphan_ids = orphans.map(&:id).to_set
      document.yjs_document_updates.where(id: orphan_ids.to_a).delete_all
      retained.reject! { |row| orphan_ids.include?(row.id) }
    end

    def verify_checksum!(document)
      checksum = document.yjs_state_checksum
      return if checksum.blank? # legacy row — heals on its next merge
      return if checksum == state_checksum(document.yjs_state)

      raise YjsPersistence::CorruptStateError, "document #{document.id}: yjs_state checksum mismatch"
    end

    def state_checksum(blob)
      Digest::SHA256.hexdigest(blob)
    end
  end
end
