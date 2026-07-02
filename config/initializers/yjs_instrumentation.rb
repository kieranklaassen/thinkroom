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
    outcome = payload[:outcome] || payload[:reason] || (payload[:exception] ? "error" : "ok")

    fields = {
      event: event.name,
      document_id: payload[:document_id],
      outcome: outcome,
      duration_ms: event.duration.round(1)
    }
    %i[update_bytes blob_bytes blob_bytes_before blob_bytes_after lock_wait_ms
       sequence expected_sequence].each do |key|
      fields[key] = payload[key] if payload.key?(key)
    end
    fields[:error] = payload[:exception].first if payload[:exception]
    line = fields.map { |key, value| "#{key}=#{value}" }.join(" ")

    success = %w[merged noop persisted ok].include?(outcome)
    if !success
      Rails.logger.warn(line)
    elsif event.duration >= slow_ms
      Rails.logger.info(line)
    else
      Rails.logger.debug(line)
    end
  end
end
