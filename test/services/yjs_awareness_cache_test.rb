require "test_helper"

class YjsAwarenessCacheTest < ActiveSupport::TestCase
  def encode_var_uint(value)
    bytes = []
    loop do
      byte = value & 0x7f
      value >>= 7
      bytes << (value.zero? ? byte : byte | 0x80)
      break if value.zero?
    end
    bytes.pack("C*")
  end

  def awareness_bytes_for(client_id, clock: 1, state_json: '{"user":{"name":"Ada"}}')
    encode_var_uint(1) +
      encode_var_uint(client_id) +
      encode_var_uint(clock) +
      encode_var_uint(state_json.bytesize) +
      state_json.b
  end

  test "put stores per-document awareness and peers_for excludes self by key or cid" do
    YjsAwarenessCache.put(1, "sub-a", update: "AAA=", cid: "cid-a", client_id: 101)
    YjsAwarenessCache.put(1, "sub-b", update: "BBB=", cid: "cid-b", client_id: 202)
    YjsAwarenessCache.put(2, "sub-c", update: "CCC=", cid: "cid-c", client_id: 303)

    peers = YjsAwarenessCache.peers_for(1, exclude_key: "sub-a")
    assert_equal [ "cid-b" ], peers.map(&:cid)
    assert_equal [ 202 ], peers.map(&:client_id)

    by_cid = YjsAwarenessCache.peers_for(1, exclude_cid: "cid-a")
    assert_equal [ "cid-b" ], by_cid.map(&:cid)
  end

  test "remove returns the removed entry and drops the document bucket when empty" do
    YjsAwarenessCache.put(1, "sub-a", update: "AAA=", cid: "cid-a", client_id: 101)

    removed = YjsAwarenessCache.remove(1, "sub-a")
    assert_equal "cid-a", removed.cid
    assert_equal 101, removed.client_id
    assert_nil YjsAwarenessCache::STORE[1]
    assert_nil YjsAwarenessCache.remove(1, "sub-a")
  end

  test "active_client_id? tracks whether another subscriber still holds the client_id" do
    YjsAwarenessCache.put(1, "sub-old", update: "AAA=", cid: "cid-a", client_id: 101)
    YjsAwarenessCache.put(1, "sub-new", update: "BBB=", cid: "cid-a", client_id: 101)

    YjsAwarenessCache.remove(1, "sub-old")
    assert YjsAwarenessCache.active_client_id?(1, 101)

    YjsAwarenessCache.remove(1, "sub-new")
    assert_not YjsAwarenessCache.active_client_id?(1, 101)
  end

  test "clear_document drops only the targeted document" do
    YjsAwarenessCache.put(1, "sub-a", update: "AAA=", cid: "cid-a", client_id: 101)
    YjsAwarenessCache.put(2, "sub-b", update: "BBB=", cid: "cid-b", client_id: 202)

    YjsAwarenessCache.clear_document(1)

    assert_empty YjsAwarenessCache.peers_for(1)
    assert_equal [ "cid-b" ], YjsAwarenessCache.peers_for(2).map(&:cid)
  end

  test "extract_client_id decodes single-client frames and returns nil for invalid or multi-client frames" do
    assert_equal 42_949, YjsAwarenessCache.extract_client_id(awareness_bytes_for(42_949))
    assert_nil YjsAwarenessCache.extract_client_id("\x00\x00\x00".b)
    assert_nil YjsAwarenessCache.extract_client_id("\x02\x01\x01".b)
    assert_nil YjsAwarenessCache.extract_client_id("\x80".b)
    assert_nil YjsAwarenessCache.extract_client_id("".b)
  end
end
