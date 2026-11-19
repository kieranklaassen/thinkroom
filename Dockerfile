# syntax=docker/dockerfile:1
# check=error=true

# This Dockerfile is designed for production, not development:
# docker build -t pruf .
# docker run -d -p 80:80 -e RAILS_MASTER_KEY=<value from config/master.key> --name pruf pruf

# For a containerized dev environment, see Dev Containers: https://guides.rubyonrails.org/getting_started_with_devcontainer.html

# Make sure RUBY_VERSION matches the Ruby version in .ruby-version
ARG RUBY_VERSION=3.4.13
# The published image the patched Ruby is compiled over (see the block below FROM).
ARG RUBY_BASE_VERSION=3.4.2
FROM docker.io/library/ruby:$RUBY_BASE_VERSION-slim AS base
# Ruby 3.4.13 is compiled from its release tarball over the ruby:$RUBY_BASE_VERSION-slim
# image, because docker.io/library/ruby:3.4.13-slim is not published yet. It fixes the
# Regexp and String vulnerabilities of 2026-11-18 (https://www.ruby-lang.org/en/news/2026/11/18/multiple-vulnerabilities-in-regexp-and-string/).
# When that image is out: delete this block and RUBY_BASE_VERSION, and build FROM
# ruby:$RUBY_VERSION-slim again. RUBY_SOURCE_VERSION has its own name because the
# base image sets ENV RUBY_VERSION, and an ENV beats an ARG of the same name.
ARG RUBY_SOURCE_VERSION=3.4.13
ARG RUBY_SOURCE_SHA256=6474dff9c02ea685fc44877a4807a27366bf109b176dad182108bb8c96d09589
RUN set -eux; \
    savedAptMark="$(apt-mark showmanual)"; \
    apt-get update -qq; \
    apt-get install --no-install-recommends -y ca-certificates dpkg-dev g++ gcc make rustc wget xz-utils \
      libffi-dev libgmp-dev libssl-dev libyaml-dev zlib1g-dev; \
    wget -qO /tmp/ruby.tar.xz "https://cache.ruby-lang.org/pub/ruby/${RUBY_SOURCE_VERSION%.*}/ruby-${RUBY_SOURCE_VERSION}.tar.xz"; \
    echo "${RUBY_SOURCE_SHA256} */tmp/ruby.tar.xz" | sha256sum --check --strict; \
    mkdir -p /usr/src/ruby; \
    tar -xJf /tmp/ruby.tar.xz -C /usr/src/ruby --strip-components=1; \
    rm /tmp/ruby.tar.xz; \
    cd /usr/src/ruby; \
    ./configure --build="$(dpkg-architecture --query DEB_BUILD_GNU_TYPE)" --disable-install-doc --enable-shared --enable-yjit; \
    make -j"$(nproc)"; \
    make install DESTDIR=/tmp/ruby-install; \
    rm -rf /usr/local/lib/ruby /usr/local/lib/libruby* /usr/local/include/ruby-*; \
    cp -a /tmp/ruby-install/usr/local/. /usr/local/; \
    rm -rf /tmp/ruby-install; \
    cd /; \
    rm -rf /usr/src/ruby; \
    apt-mark auto '.*' > /dev/null; \
    [ -z "$savedAptMark" ] || apt-mark manual $savedAptMark > /dev/null; \
    find /usr/local -type f -executable -not -path '/usr/local/bundle/*' -exec ldd '{}' ';' 2>/dev/null \
      | awk '/=>/ { so = $(NF-1); if (index(so, "/usr/local/") == 1) { next }; gsub("^/(usr/)?", "", so); printf "*%s\n", so }' \
      | sort -u | xargs -r dpkg-query --search | cut -d: -f1 | sort -u | xargs -r apt-mark manual; \
    apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb; \
    ruby -e 'abort "built #{RUBY_VERSION}, wanted #{ARGV[0]}" unless RUBY_VERSION == ARGV[0]' "$RUBY_SOURCE_VERSION"; \
    ruby --yjit -e 'abort "no YJIT" unless RubyVM::YJIT.enabled?'; \
    gem --version; bundle --version
ENV RUBY_VERSION=$RUBY_SOURCE_VERSION \
    RUBY_DOWNLOAD_URL=https://cache.ruby-lang.org/pub/ruby/3.4/ruby-$RUBY_SOURCE_VERSION.tar.xz \
    RUBY_DOWNLOAD_SHA256=$RUBY_SOURCE_SHA256


# Rails app lives here
WORKDIR /rails

# Install base packages
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y curl libjemalloc2 libvips sqlite3 && \
    ln -s /usr/lib/$(uname -m)-linux-gnu/libjemalloc.so.2 /usr/local/lib/libjemalloc.so && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

# Set production environment variables and enable jemalloc for reduced memory usage and latency.
ENV RAILS_ENV="production" \
    BUNDLE_DEPLOYMENT="1" \
    BUNDLE_PATH="/usr/local/bundle" \
    BUNDLE_WITHOUT="development" \
    LD_PRELOAD="/usr/local/lib/libjemalloc.so"

# Throw-away build stage to reduce size of final image
FROM base AS build

# Install packages needed to build gems and Node.js for Vite
ARG NODE_VERSION=22
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential git libsqlite3-dev libvips libyaml-dev pkg-config curl && \
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - && \
    apt-get install --no-install-recommends -y nodejs && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

# Install application gems
COPY Gemfile Gemfile.lock ./

RUN bundle install && \
    rm -rf ~/.bundle/ "${BUNDLE_PATH}"/ruby/*/cache "${BUNDLE_PATH}"/ruby/*/bundler/gems/*/.git && \
    # -j 1 disable parallel compilation to avoid a QEMU bug: https://github.com/rails/bootsnap/issues/495
    bundle exec bootsnap precompile -j 1 --gemfile

# Install Node.js dependencies (vite + plugins live in devDependencies; NODE_ENV stays unset here)
COPY package.json package-lock.json ./
RUN npm ci

# Copy application code
COPY . .

# Precompile bootsnap code for faster boot times.
# -j 1 disable parallel compilation to avoid a QEMU bug: https://github.com/rails/bootsnap/issues/495
RUN bundle exec bootsnap precompile -j 1 app/ lib/

# Precompiling assets for production without requiring secret RAILS_MASTER_KEY
# (this runs the Vite CLIENT build via vite-plugin-ruby).
RUN SECRET_KEY_BASE_DUMMY=1 ./bin/rails assets:precompile

# Build the Inertia SSR bundle. `bin/vite build --ssr` (vite-ruby's flavor)
# insists on its own app/frontend/ssr/ssr.js entry; we use the @inertiajs/vite
# plugin path instead. vite-plugin-ruby resolves the SSR entrypoint from
# config/vite.json (ssrEntrypoint) and emits the entry chunk to
# public/vite-ssr/ssr.js — exactly where config.ssr_bundle expects it. The
# emitted file is a standalone Node server (createServer on port 13714).
RUN npx vite build --ssr




# Final stage for app image
FROM base

# Install a minimal Node.js runtime so the final image can run the Inertia SSR
# bundle (public/vite-ssr/ssr.js). The build stage installed Node from
# nodesource; mirror that here. node_modules are NOT copied into the runtime
# image — the SSR bundle is self-contained (Vite bundles its deps), so only the
# `node` binary is needed. If this install ever fails the image build fails
# loudly rather than shipping a runtime that silently can't run SSR.
ARG NODE_VERSION=22
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - && \
    apt-get install --no-install-recommends -y nodejs && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

# Run and own only the runtime files as a non-root user for security
RUN groupadd --system --gid 1000 rails && \
    useradd rails --uid 1000 --gid 1000 --create-home --shell /bin/bash
USER 1000:1000

# Copy built artifacts: gems, application
COPY --chown=rails:rails --from=build "${BUNDLE_PATH}" "${BUNDLE_PATH}"
COPY --chown=rails:rails --from=build /rails /rails

# Entrypoint prepares the database.
ENTRYPOINT ["/rails/bin/docker-entrypoint"]

# Start server via Thruster by default, this can be overwritten at runtime
EXPOSE 80
CMD ["./bin/thrust", "./bin/rails", "server"]
