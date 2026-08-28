require "test_helper"

class WebmcpOriginTrialTest < ActiveSupport::TestCase
  test "returns a well-formed token" do
    assert_equal "AbC123+/=", WebmcpOriginTrial.token_from({ "WEBMCP_ORIGIN_TRIAL_TOKEN" => "AbC123+/=" })
  end

  test "rejects a value carrying markup" do
    assert_nil WebmcpOriginTrial.token_from({ "WEBMCP_ORIGIN_TRIAL_TOKEN" => "AbC\"><script>alert(1)</script>" })
  end

  test "returns nil when the variable is missing" do
    assert_nil WebmcpOriginTrial.token_from({})
  end

  test "returns nil when the variable is empty" do
    assert_nil WebmcpOriginTrial.token_from({ "WEBMCP_ORIGIN_TRIAL_TOKEN" => "" })
  end
end
