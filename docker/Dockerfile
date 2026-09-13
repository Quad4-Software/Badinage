# syntax=docker/dockerfile:1

# Base images are pinned by digest. Bump deliberately, see .agents/docs/security.md.
ARG NODE_IMAGE=docker.io/library/node:26-alpine@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868
ARG NGINX_IMAGE=docker.io/nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6

# pnpm is pinned by sha256 against the upstream release tarball. Bump the
# version and both sums together.
ARG PNPM_VERSION=11.24.0
ARG PNPM_SHA256_X64=2fce00e10729d0c1f3836d499b908697fd3cd0832332651fbcee79c0a7442dcb
ARG PNPM_SHA256_ARM64=950160e3d1d039e0bd1f234da5a307fdc9c1d6b9c030683adfcb85f607c7d500

FROM ${NODE_IMAGE} AS build
WORKDIR /app

ARG PNPM_VERSION
ARG PNPM_SHA256_X64
ARG PNPM_SHA256_ARM64
ARG TARGETARCH

RUN set -eu; \
    case "${TARGETARCH:-$(uname -m)}" in \
      amd64|x86_64) pnpm_arch=x64; pnpm_sum="$PNPM_SHA256_X64" ;; \
      arm64|aarch64) pnpm_arch=arm64; pnpm_sum="$PNPM_SHA256_ARM64" ;; \
      *) echo "unsupported arch" >&2; exit 1 ;; \
    esac; \
    wget -qO /tmp/pnpm.tgz "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linux-${pnpm_arch}-musl.tar.gz"; \
    echo "$pnpm_sum  /tmp/pnpm.tgz" | sha256sum -c -; \
    mkdir -p /usr/local/lib/pnpm; \
    tar -xzf /tmp/pnpm.tgz -C /usr/local/lib/pnpm; \
    ln -s /usr/local/lib/pnpm/pnpm /usr/local/bin/pnpm; \
    rm /tmp/pnpm.tgz

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ patches/
COPY packages/omemo/package.json packages/omemo/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM ${NGINX_IMAGE}

ARG VERSION=0.0.0
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="Badinage" \
      org.opencontainers.image.description="Self-hostable web XMPP client" \
      org.opencontainers.image.url="https://github.com/Quad4-Software/badinage" \
      org.opencontainers.image.source="https://github.com/Quad4-Software/badinage" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.licenses="0BSD" \
      org.opencontainers.image.vendor="Quad4 Software"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

# nginx-unprivileged already runs as the nginx user, no root processes.
CMD ["nginx", "-g", "daemon off;"]
