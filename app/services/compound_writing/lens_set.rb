module CompoundWriting
  # The lenses an account can run right now: every enabled lens across its
  # packs, in pack order then lens order, with a duplicate key kept from the
  # first pack. The controller validates run requests against this set and
  # the page ships it as `writing_reviewers`.
  class LensSet
    def self.for(user)
      return new([], []) if user.nil?

      subscriptions = user.user_writing_packs.includes(:writing_pack).order(:position, :id).to_a
      lenses = {}
      subscriptions.each do |subscription|
        subscription.enabled_lenses.each { |lens| lenses[lens.key] ||= lens }
      end
      new(lenses.values, subscriptions)
    end

    attr_reader :lenses, :subscriptions

    def initialize(lenses, subscriptions)
      @lenses = lenses
      @subscriptions = subscriptions
    end

    def keys = lenses.map(&:key)
    def find(key) = lenses.find { |lens| lens.key == key.to_s }
    def empty? = lenses.empty?

    # The requested keys, deduplicated, each one enabled for this account.
    def select!(requested)
      wanted = Array(requested).map(&:to_s).uniq
      unknown = wanted.reject { |key| find(key) }
      raise ArgumentError, "unknown or disabled reviewers #{unknown.join(', ')}" if unknown.any?

      wanted.map { |key| find(key) }
    end

    def as_props = lenses.map(&:as_props)

    def packs_props
      subscriptions.map { |subscription| subscription.writing_pack.as_props(disabled_keys: subscription.disabled_lens_keys) }
    end
  end
end
