require "test_helper"

class CompoundWriting::ParagraphDigestTest < ActiveSupport::TestCase
  Digest = CompoundWriting::ParagraphDigest

  test "is stable, order-sensitive, and eight hex characters" do
    assert_equal Digest.of(%w[a b]), Digest.of(%w[a b])
    assert_not_equal Digest.of(%w[a b]), Digest.of(%w[b a])
    assert_not_equal Digest.of([ "ab" ]), Digest.of(%w[a b])
    assert_match(/\A[0-9a-f]{8}\z/, Digest.of([ "Hello, wörld 🌍" ]))
  end

  test "matches the reference vector the browser projection uses" do
    # FNV-1a 32-bit of "a" is 0xe40c292c; the client test fixture mirrors it.
    assert_equal "e40c292c", Digest.of([ "a" ])
    assert_equal "811c9dc5", Digest.of([])
  end
end
