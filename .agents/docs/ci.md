# CI and release

## Workflows

- ci.yml: lint, svelte-check, vitest with v8 coverage thresholds
  (vite.config.ts test.coverage.thresholds), knip dead-code check, and
  build on node 22 and 24, plus a Playwright e2e job (chromium) and a
  benchmark smoke job (pnpm bench, output archived as an artifact).
  The e2e job also brings up the dev prosody container
  (docker/dev/compose.yaml), waits for the http port on 5280, seeds
  e2e-alice and e2e-bob with prosodyctl register, and runs the suite
  with E2E_PROSODY=1 so the server-backed specs in e2e/server.test.ts
  execute. The container is torn down with compose down -v in an
  always() step. Locally: docker compose -f docker/dev/compose.yaml
  up -d prosody, register the two users the same way, then
  E2E_PROSODY=1 pnpm test:e2e.
  pnpm store is cached through setup-node.
  PR runs cancel in progress on new pushes, main never cancels.
- mutation.yml: weekly cron plus manual dispatch. Runs stryker with the
  vitest runner on root and packages/omemo, uploads the html/json report
  as an artifact. The vitest runner is patched (pnpm-workspace.yaml
  patchedDependencies) because vitest 5 changed testNamePattern matching
  to leaf test names, which would silently skip every filtered mutant.
  Local runs: pnpm mutate, pnpm --filter @quad4-software/omemo mutate.
  Keep .stryker-tmp/ and reports/ out of lint and git.
- codeql.yml: CodeQL javascript-typescript, security-and-quality queries,
  build-mode none, weekly cron. Actions pinned by SHA.
- dependency-review.yml: fails PRs introducing high severity deps.
- docker.yml: on main and v*._._ tags. buildx for linux/amd64+linux/arm64,
  gha layer cache, pushes to ghcr.io/<repo>, signs keyless with cosign
  (Fulcio + Rekor via id-token) and attaches a build provenance attestation
  with actions/attest-build-provenance.
- scorecard.yml: OpenSSF Scorecard weekly, uploads SARIF to code scanning.
- pages.yml: builds and deploys the demo to GitHub Pages on master. The
  build sets VITE_BASE to the repo subpath and VITE_DEMO=1 so the site
  lands in demo mode. The demo account is fake. Demo data only.

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
