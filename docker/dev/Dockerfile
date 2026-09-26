# syntax=docker/dockerfile:1

# Dev container: mounts the repo and runs the Vite dev server with HMR.
FROM docker.io/library/node:26-alpine@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868

ARG TARGETARCH

RUN set -eu; \
    case "${TARGETARCH:-$(uname -m)}" in \
      amd64|x86_64) pnpm_arch=x64; pnpm_sum=bf23d242a6c7a4d42b21bf1d93bff9d6a473cf8b6a7a990c6ed3094228513048 ;; \
      arm64|aarch64) pnpm_arch=arm64; pnpm_sum=61e5a2b9aa8c1ebb73ea22203021531f88b8aff9499b68be03f695d9377928c1 ;; \
      *) echo "unsupported arch" >&2; exit 1 ;; \
    esac; \
    wget -qO /tmp/pnpm.tgz "https://github.com/pnpm/pnpm/releases/download/v12.6.0/pnpm-linux-${pnpm_arch}-musl.tar.gz"; \
    echo "$pnpm_sum  /tmp/pnpm.tgz" | sha256sum -c -; \
    mkdir -p /usr/local/lib/pnpm; \
    tar -xzf /tmp/pnpm.tgz -C /usr/local/lib/pnpm; \
    ln -s /usr/local/lib/pnpm/pnpm /usr/local/bin/pnpm; \
    rm /tmp/pnpm.tgz

WORKDIR /app
EXPOSE 5173

CMD ["sh", "-c", "pnpm install && pnpm dev --host"]
