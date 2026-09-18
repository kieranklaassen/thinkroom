module CompoundWriting
  # Splits a paragraph into the units Jev is asked about. Offsets are character
  # offsets into the paragraph, so a finding can be anchored back into the live
  # editor by (paragraph, offset, length). Sentences split after terminal
  # punctuation followed by whitespace and an opener; a short abbreviation list
  # keeps "Dr. Smith" together. N-grams follow Jevgram: 1-3 words, never across
  # a comma, semicolon, colon, dash, bracket, quote, or sentence boundary.
  module Segmenter
    Sentence = Data.define(:text, :offset)
    Word = Data.define(:text, :offset)
    # `words` is the index of the first word and `n` the word count, so the
    # selection pass can keep picks from overlapping inside a sentence.
    Gram = Data.define(:text, :offset, :first_word, :n)

    ABBREVIATIONS = %w[dr mr mrs ms prof sr jr st vs etc e.g i.e no fig vol al].freeze
    MAX_N = 3
    SENTENCE_BREAK = /[.!?]+["'”’)\]]*(?=\s+["'“‘(\[]?[\p{Lu}\p{N}])/
    WORD = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/
    PHRASE_BREAK = /[,;:—–\-\(\)\[\]"“”\n]/

    module_function

    def sentences(paragraph)
      text = paragraph.to_s
      result = []
      start = 0
      text.scan(SENTENCE_BREAK) do
        match = Regexp.last_match
        stop = match.end(0)
        next if abbreviation?(text, match.begin(0))

        add_sentence(result, text, start, stop)
        start = stop
      end
      add_sentence(result, text, start, text.length)
      result
    end

    def words(sentence)
      text = sentence.to_s
      result = []
      text.scan(WORD) { result << Word.new(text: Regexp.last_match(0), offset: Regexp.last_match.begin(0)) }
      result
    end

    def word_count(text) = words(text).size

    def ngrams(sentence, max_n: MAX_N)
      text = sentence.to_s
      list = words(text)
      grams = []
      list.each_with_index do |first, index|
        (1..max_n).each do |n|
          last = list[index + n - 1]
          break unless last
          break if n > 1 && crosses_break?(text, list[index + n - 2], last)

          grams << Gram.new(text: text[first.offset...(last.offset + last.text.length)], offset: first.offset, first_word: index, n:)
        end
      end
      grams
    end

    def abbreviation?(text, punctuation_index)
      return false unless text[punctuation_index] == "."

      word_start = punctuation_index
      word_start -= 1 while word_start.positive? && text[word_start - 1].match?(/[\p{L}.]/)
      ABBREVIATIONS.include?(text[word_start...punctuation_index].downcase)
    end

    def crosses_break?(text, previous_word, word)
      gap = text[(previous_word.offset + previous_word.text.length)...word.offset]
      gap.match?(PHRASE_BREAK)
    end

    def add_sentence(result, text, start, stop)
      segment = text[start...stop]
      leading = segment.length - segment.lstrip.length
      stripped = segment.strip
      result << Sentence.new(text: stripped, offset: start + leading) unless stripped.empty?
    end
    private_class_method :abbreviation?, :crosses_break?, :add_sentence
  end
end
