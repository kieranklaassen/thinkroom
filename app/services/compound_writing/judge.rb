module CompoundWriting
  # Asks Jev a batch of Nouls about one state and returns their probabilities
  # in order. Requests stay under Jev's budget (64k tokens per request, of
  # which the state may use 32k) with Jevgram's conservative estimate of three
  # characters per token, and under a Noul cap that keeps each request fast.
  # Every failure surfaces as a JudgeError so the reviewer job can record it.
  class Judge
    MAX_NOULS_PER_REQUEST = 200
    REQUEST_TOKEN_BUDGET = 48_000
    NOUL_OVERHEAD_TOKENS = 8

    # One process-wide gate on in-flight TypeSafe requests, shared by every
    # reviewer job of every pass (Limits.max_concurrent_jev_calls). Sized at
    # boot from the environment; a running process keeps its size.
    SEMAPHORE = Concurrent::Semaphore.new(Limits.max_concurrent_jev_calls)

    def self.with_slot
      SEMAPHORE.acquire
      begin
        yield
      ensure
        SEMAPHORE.release
      end
    end

    def initialize(model: CompoundWriting.model, chat: nil)
      @model = model
      @chat = chat
    end

    # state: Hash sent as the request state (for example { paragraph: text }).
    # nouls: Array<Noul>. Returns Array<Float> aligned with nouls.
    def judge(state:, nouls:)
      return [] if nouls.empty?

      probabilities = Array.new(nouls.size)
      batches(state, nouls).each do |indexes|
        answers = ask(state, indexes.map { |index| nouls[index] })
        indexes.each_with_index do |index, position|
          answer = answers["q#{position}"]
          noul = answer.is_a?(Hash) ? answer["noul"] : nil
          raise JudgeError.new("TypeSafe answered without q#{position}", reviewer_key: nouls[index].reviewer_key) if noul.nil?

          probabilities[index] = noul.to_f
        end
      end
      probabilities
    end

    def batches(state, nouls)
      capacity = REQUEST_TOKEN_BUDGET - estimate_tokens(state)
      batches = []
      current = []
      used = 0
      nouls.each_with_index do |noul, index|
        cost = estimate_tokens(noul.instruction) + estimate_tokens(noul.criteria) + NOUL_OVERHEAD_TOKENS
        if current.any? && (used + cost > capacity || current.size >= MAX_NOULS_PER_REQUEST)
          batches << current
          current = []
          used = 0
        end
        current << index
        used += cost
      end
      batches << current if current.any?
      batches
    end

    private

    def ask(state, nouls)
      schema = RubyLLM::Providers::TypeSafe::Schema.new do |builder|
        nouls.each_with_index do |noul, position|
          builder.noul "q#{position}", instructions: noul.instruction, criteria: noul.criteria
        end
      end
      response = self.class.with_slot { chat.with_schema(schema).ask(state.to_json) }
      answers = response.parsed
      raise JudgeError.new("TypeSafe answered without an answer map", reviewer_key: nouls.first.reviewer_key) unless answers.is_a?(Hash)

      answers
    rescue RubyLLM::Error, Faraday::Error, Timeout::Error, JSON::ParserError => e
      raise JudgeError.new("#{e.class.name.demodulize}: #{e.message.to_s.byteslice(0, 300)}", reviewer_key: nouls.first.reviewer_key)
    end

    def chat
      @chat || RubyLLM.chat(model: @model, provider: :typesafe)
    end

    def estimate_tokens(value)
      (value.to_json.length / 3.0).ceil
    end
  end
end
