# syntax=docker/dockerfile:1

# Dev container: mounts the repo and runs the Vite dev server with HMR.
FROM docker.io/library/node:26-alpine@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868

RUN npm install -g pnpm@11.24.0

WORKDIR /app
EXPOSE 5173

CMD ["sh", "-c", "pnpm install && pnpm dev --host"]
