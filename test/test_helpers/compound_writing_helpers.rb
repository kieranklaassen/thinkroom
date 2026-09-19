# Shared fixtures for compound writing tests: the curated compound-writing
# pack built offline, its lenses by skill name, and a featured account.
module CompoundWritingHelpers
  PASSWORD = "thoughtful-passphrase"

  def compound_pack
    @compound_pack ||= CompoundWriting::Bootstrap.ensure_pack!
  end

  def compound_lens(skill)
    compound_pack.lens("compound-writing/#{skill}") or raise ArgumentError, "no lens for #{skill}"
  end

  def compound_lenses(*skills) = skills.map { |skill| compound_lens(skill) }

  # A password account holding the feature and subscribed to the pack.
  def featured_user!(email: "reviewer@example.com", name: "Reviewer")
    user = User.create!(name:, email:, password: PASSWORD)
    user.grant_feature!(Features::COMPOUND_WRITING)
    UserWritingPack.create!(user:, writing_pack: compound_pack, disabled_lens_keys: [])
    user
  end

  def sign_in_as(user)
    post login_path, params: { email: user.email, password: PASSWORD }
    assert_response :redirect
  end
end
