module FeedbackAutomation
  module_function

  def allowed?(user)
    user.present? && allowed_emails.include?(user.account_email.downcase)
  end

  def allowed_emails
    Rails.application.config.x.riffrec_automation_emails
  end
end
