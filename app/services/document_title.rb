class DocumentTitle
  MAX_LENGTH = 255

  class << self
    def call(format:, content:)
      self.in(DocumentPlainText.fragment(format:, content:))
    end

    # The title in an already parsed source (DocumentPlainText.fragment).
    def in(fragment)
      fragment.at_xpath(".//h1")
        &.text
        &.squish
        &.first(MAX_LENGTH)
        &.presence
    end
  end
end
