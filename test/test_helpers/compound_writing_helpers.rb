# Shared fixtures for compound writing tests: the curated compound-writing
# pack built offline, its lenses by skill name, and an account with the
# :compound_writing flag enabled (Flipper, per actor, as in Cora's tests).
module CompoundWritingHelpers
  PASSWORD = "thoughtful-passphrase"

  def compound_pack
    @compound_pack ||= CompoundWriting::FirstPack.ensure_pack!
  end

  def compound_lens(skill)
    compound_pack.lens("compound-writing/#{skill}") or raise ArgumentError, "no lens for #{skill}"
  end

  def compound_lenses(*skills) = skills.map { |skill| compound_lens(skill) }

  # A password account with the flag enabled and the first pack subscribed
  # (already seeded, so a Comment-mode visit adds nothing).
  def featured_user!(email: "reviewer@example.com", name: "Reviewer", admin: false)
    user = User.create!(name:, email:, password: PASSWORD, admin:)
    Flipper.enable(CompoundWriting::FLAG, user)
    UserWritingPack.subscribe!(user, compound_pack)
    user.update!(compound_writing_seeded_at: Time.current)
    user
  end

  def sign_in_as(user)
    post login_path, params: { email: user.email, password: PASSWORD }
    assert_response :redirect
  end
end
