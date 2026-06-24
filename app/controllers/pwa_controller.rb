class PwaController < ApplicationController
  def manifest
    render layout: false, content_type: "application/manifest+json"
  end
end
