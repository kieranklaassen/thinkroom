class Document < ApplicationRecord
  DEFAULT_SEED = "# Untitled\n\nStart writing — everything you type is attributed to you.\n"

  attr_readonly :slug

  before_validation :ensure_slug, on: :create

  validates :title, presence: true
  validates :slug, presence: true, uniqueness: true

  def to_param = slug

  # Percentage breakdown derived from the latest client-pushed provenance snapshot.
  # Spans: [{ "kind" => "human"|"ai", "state" => ..., "chars" => N }, ...]
  def provenance_summary
    spans = Array(provenance_spans)
    total = spans.sum { |s| s["chars"].to_i }
    return { total: 0, human_pct: 0, ai_pct: 0, unreviewed_pct: 0 } if total.zero?

    human = spans.select { |s| s["kind"] == "human" }.sum { |s| s["chars"].to_i }
    ai = total - human
    unreviewed = spans.select { |s| s["kind"] == "ai" && s["state"] == "pending" }.sum { |s| s["chars"].to_i }

    {
      total: total,
      human_pct: (human * 100.0 / total).round,
      ai_pct: (ai * 100.0 / total).round,
      unreviewed_pct: (unreviewed * 100.0 / total).round
    }
  end

  private

  def ensure_slug
    self.slug ||= SecureRandom.base58(10)
  end
end
