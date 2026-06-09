module Api
  class DirectUploadsController < ActionController::API
    def create
      render json: {
        error: "Direct uploads are disabled. POST a multipart file to /api/uploads."
      }, status: :not_found
    end
  end
end
