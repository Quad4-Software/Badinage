# syntax=docker/dockerfile:1

# Dev container: mounts the repo and runs the Vite dev server with HMR.
FROM docker.io/library/node:26-alpine@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868

ARG TARGETARCH

RUN set -eu; \
    case "${TARGETARCH:-$(uname -m)}" in \
      amd64|x86_64) pnpm_arch=x64; pnpm_sum=cc66c1558a1a03b320ff5b4022f755386fa1de54db3f97ff624112015be1ccf1 ;; \
      arm64|aarch64) pnpm_arch=arm64; pnpm_sum=7a7854e90bdb7d339430d9943ea482b34d7bde817cfc1c749d3c04ddd464142d ;; \
      *) echo "unsupported arch" >&2; exit 1 ;; \
    esac; \
    wget -qO /tmp/pnpm.tgz "https://github.com/pnpm/pnpm/releases/download/v11.27.1/pnpm-linux-${pnpm_arch}-musl.tar.gz"; \
    echo "$pnpm_sum  /tmp/pnpm.tgz" | sha256sum -c -; \
    mkdir -p /usr/local/lib/pnpm; \
    tar -xzf /tmp/pnpm.tgz -C /usr/local/lib/pnpm; \
    ln -s /usr/local/lib/pnpm/pnpm /usr/local/bin/pnpm; \
    rm /tmp/pnpm.tgz

WORKDIR /app
EXPOSE 5173

CMD ["sh", "-c", "pnpm install && pnpm dev --host"]
