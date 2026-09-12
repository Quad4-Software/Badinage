# CI and release

## Workflows

- ci.yml: lint, svelte-check, vitest, build on node 22 and 24, plus a
  Playwright e2e job (chromium). pnpm store is cached through setup-node.
  PR runs cancel in progress on new pushes, main never cancels.
- codeql.yml: CodeQL javascript-typescript, security-and-quality queries,
  build-mode none, weekly cron. Actions pinned by SHA.
- dependency-review.yml: fails PRs introducing high severity deps.
- docker.yml: on main and v*._._ tags. buildx for linux/amd64+linux/arm64,
  gha layer cache, pushes to ghcr.io/<repo>, signs keyless with cosign
  (Fulcio + Rekor via id-token) and attaches a build provenance attestation
  with actions/attest-build-provenance.
- scorecard.yml: OpenSSF Scorecard weekly, uploads SARIF to code scanning.

## Rules

- Every job starts with step-security/harden-runner on a pinned SHA,
  egress-policy audit. Switch to block with an explicit allowlist if a job
  needs tighter egress.
- All actions pinned to commit SHA with a version comment. Dependabot
  (.github/dependabot.yml) bumps them weekly.
- No pull_request_target, no run steps on untrusted PR input, no secrets
  in logs.
- permissions: blocks stay minimal per job. docker.yml needs id-token:
  write for cosign keyless signing, nothing else does.

## Images

- Prod image: docker/Dockerfile, node build stage into
  nginxinc/nginx-unprivileged. Both bases are pinned by digest.
- OCI labels come from build args VERSION/VCS_REF/BUILD_DATE plus
  metadata-action labels in docker.yml.
- Dev stack lives in docker/dev/ (Vite dev server + Prosody) and never
  ships.
