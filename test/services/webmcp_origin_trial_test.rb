require "test_helper"

class WebmcpOriginTrialTest < ActiveSupport::TestCase
  test "returns a well-formed token" do
    assert_equal [ "AbC123+/=" ], WebmcpOriginTrial.tokens_from({ "WEBMCP_ORIGIN_TRIAL_TOKEN" => "AbC123+/=" })
  end

  test "returns one token per registered origin from a separated list" do
    assert_equal [ "AbC123+/=", "XyZ789==" ],
                 WebmcpOriginTrial.tokens_from({ "WEBMCP_ORIGIN_TRIAL_TOKEN" => "AbC123+/= ,\nXyZ789==" })
  end

  test "drops a value carrying markup and keeps the well-formed ones" do
    assert_equal [ "AbC123" ],
                 WebmcpOriginTrial.tokens_from({ "WEBMCP_ORIGIN_TRIAL_TOKEN" => "AbC\"><script>alert(1)</script> AbC123" })
  end

  test "returns no tokens when the variable is missing" do
    assert_equal [], WebmcpOriginTrial.tokens_from({})
  end

  test "returns no tokens when the variable is empty" do
    assert_equal [], WebmcpOriginTrial.tokens_from({ "WEBMCP_ORIGIN_TRIAL_TOKEN" => "" })
  end
end
