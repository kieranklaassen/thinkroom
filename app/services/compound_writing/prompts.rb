module CompoundWriting
  # One Jev Noul per (question, unit) pair, phrased the Jevgram way: the unit is
  # named literally in the instruction and the enclosing text travels as the
  # request state, so the model judges exactly that span in context.
  # `subject` is the unit's own text and `lexicon` the lens's FakeJudge words,
  # both kept for the fake judge and for logging.
  Noul = Data.define(:instruction, :criteria, :subject, :reviewer_key, :question_id, :scope, :lexicon)

  module Prompts
    module_function

    def phrase(question, reviewer, phrase)
      Noul.new(
        instruction: "Consider the exact phrase \"#{phrase}\" as it is used in `paragraph`. #{question.question}",
        criteria: { true => "The phrase \"#{phrase}\" itself fits this description",
                    false => "The phrase \"#{phrase}\" does not fit this description" },
        subject: phrase, reviewer_key: reviewer.key, question_id: question.id, scope: "phrase", lexicon: reviewer.lexicon
      )
    end

    def sentence(question, reviewer, sentence)
      Noul.new(
        instruction: "Consider the sentence \"#{sentence}\" as it is used in `paragraph`. #{question.question}",
        criteria: { true => "That sentence itself fits this description",
                    false => "That sentence does not fit this description" },
        subject: sentence, reviewer_key: reviewer.key, question_id: question.id, scope: "sentence", lexicon: reviewer.lexicon
      )
    end

    def paragraph(question, reviewer, paragraph)
      Noul.new(
        instruction: "Consider `paragraph` as a whole. #{question.question}",
        criteria: { true => "The paragraph as a whole fits this description",
                    false => "The paragraph as a whole does not fit this description" },
        subject: paragraph, reviewer_key: reviewer.key, question_id: question.id, scope: "paragraph", lexicon: reviewer.lexicon
      )
    end

    def text(question, reviewer, text)
      Noul.new(
        instruction: "Consider `text` as a whole. #{question.question}",
        criteria: { true => "The text as a whole fits this description",
                    false => "The text as a whole does not fit this description" },
        subject: text, reviewer_key: reviewer.key, question_id: question.id, scope: "text", lexicon: reviewer.lexicon
      )
    end
  end
end
