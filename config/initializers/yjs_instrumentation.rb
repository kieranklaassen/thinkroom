# Renders the structured events emitted by YjsPersistence and SyncChannel
# (merge.yjs, state.yjs, snapshot.yjs, frame_dropped.yjs) as single-line
# structured logs. Payloads carry ids, outcomes, and byte sizes only — never
# document content. External APMs can subscribe to the same /\.yjs$/ events.
Rails.application.config.after_initialize do
  # Successful hot-path operations slower than this are logged at info so
  # slow merges/joins surface without turning routine traffic into log noise.
  # Arbitrary starting point — tune once real distributions exist.
  slow_ms = 250.0

  ActiveSupport::Notifications.subscribe(/\.yjs\z/) do |event|
    payload = event.payload
    outcome = payload[:outcome] || (payload[:exception] ? "error" : "ok")

    # Failure outcomes self-classify by the emitters' naming convention
    # (rejected_* / invalid_* / dropped_*, plus the exception fallback), so
    # new success outcomes never rot an allowlist into false warns.
    failure = outcome == "error" || outcome.start_with?("rejected_", "invalid_", "dropped_")

    # Pick the level before building the log line: the merge path emits an
    # event per collaborative frame, and assembling a string that a
    # production logger would immediately discard is wasted hot-path work
    # inside the persist-before-broadcast window.
    level = if failure
      :warn
    elsif event.duration >= slow_ms && Rails.logger.info?
      :info
    elsif Rails.logger.debug?
      :debug
    end
    next unless level

    fields = {
      event: event.name,
      document_id: payload[:document_id],
      outcome: outcome,
      duration_ms: event.duration.round(1)
    }
    %i[update_bytes blob_bytes blob_bytes_before blob_bytes_after lock_wait_ms
       cache served_from sequence expected_sequence error].each do |key|
      fields[key] = payload[key] if payload.key?(key)
    end
    # Class and message ("Document::StaleGenerationError: Client generation 3
    # is behind..."); messages in this event family never carry doc content.
    fields[:error] ||= payload[:exception].join(": ") if payload[:exception]
    line = fields.map { |key, value| "#{key}=#{value}" }.join(" ")

    Rails.logger.public_send(level, line)
  end
end
