#!/bin/bash
# Inertia Rails Project Setup Script
# Usage: bash setup.sh [framework] [--typescript] [--tailwind]
#
# Arguments:
#   framework: react, vue, or svelte (default: react)
#   --typescript: Enable TypeScript support
#   --tailwind: Add Tailwind CSS
#
# This script automates Inertia Rails setup for new or existing projects.

set -e

FRAMEWORK="${1:-react}"
TYPESCRIPT=false
TAILWIND=false

# Parse flags
for arg in "$@"; do
  case $arg in
    --typescript)
      TYPESCRIPT=true
      shift
      ;;
    --tailwind)
      TAILWIND=true
      shift
      ;;
  esac
done

echo "Setting up Inertia Rails with:"
echo "  Framework: $FRAMEWORK"
echo "  TypeScript: $TYPESCRIPT"
echo "  Tailwind: $TAILWIND"
echo ""

# Check if we're in a Rails app
if [ ! -f "Gemfile" ]; then
  echo "Error: Not in a Rails application directory (no Gemfile found)"
  exit 1
fi

# Check if inertia_rails is already installed
if grep -q "inertia_rails" Gemfile; then
  echo "inertia_rails gem already in Gemfile"
else
  echo "Adding inertia_rails gem..."
  bundle add inertia_rails
fi

# Build generator command
GENERATOR_CMD="bin/rails generate inertia:install"
GENERATOR_CMD="$GENERATOR_CMD --framework=$FRAMEWORK"

if [ "$TYPESCRIPT" = true ]; then
  GENERATOR_CMD="$GENERATOR_CMD --typescript"
fi

if [ "$TAILWIND" = true ]; then
  GENERATOR_CMD="$GENERATOR_CMD --tailwind"
fi

echo "Running: $GENERATOR_CMD"
eval $GENERATOR_CMD

# Create initializer with recommended defaults if it doesn't exist
INITIALIZER_PATH="config/initializers/inertia_rails.rb"
if [ ! -f "$INITIALIZER_PATH" ]; then
  echo "Creating Inertia Rails initializer with recommended defaults..."
  cat > "$INITIALIZER_PATH" << 'RUBY'
# frozen_string_literal: true

InertiaRails.configure do |config|
  # Asset versioning for cache busting
  # Uncomment and configure based on your asset pipeline:
  # config.version = -> { ViteRuby.digest }
  # config.version = Rails.application.config.assets_version

  # Flash keys to expose to frontend (default: notice, alert)
  # config.flash_keys = %i[notice alert success error warning info]

  # Deep merge shared data with page props (default: false)
  # config.deep_merge_shared_data = true

  # Enable history encryption for sensitive data (default: false)
  # config.encrypt_history = Rails.env.production?

  # Server-side rendering (experimental)
  # config.ssr_enabled = false
  # config.ssr_url = 'http://localhost:13714'
end
RUBY
fi

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Configure asset versioning in config/initializers/inertia_rails.rb"
echo "  2. Set up shared data in ApplicationController"
echo "  3. Create your first Inertia page component"
echo ""
echo "Example controller:"
echo ""
echo "  class PagesController < ApplicationController"
echo "    def home"
echo "      render inertia: { message: 'Hello, Inertia!' }"
echo "    end"
echo "  end"
