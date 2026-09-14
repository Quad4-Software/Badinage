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
  The irc-interop job brings up the dev ergo container the same way,
  waits for the websocket port on 8097, and runs
  src/lib/core/irc/tests/ergo.live.test.ts with
  ERGO_WS=ws://localhost:8097.
  pnpm store is cached through setup-node.
  PR runs cancel in progress on new pushes, main never cancels.
- perf.yml: PRs, weekly cron plus manual dispatch. Builds dist and runs
  Lighthouse CI (lighthouserc.json, pnpm perf) against the static output.
  Assertions gate a11y and best-practices scores, total-blocking-time,
  layout shift and per-resource transfer budgets. Timing metrics warn
  rather than fail because runner speed varies. Reports upload as the
  lighthouse-reports artifact. Local runs need a Chrome binary, point
  CHROME_PATH at it if chrome-launcher cannot find one.
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
- pages.yml: builds and deploys the demo site to GitHub Pages on master.
  The build sets VITE_BASE to the repo subpath. Visitors land on the auth
  page like any other deployment and enter the fake demo account through
  the Try the demo button. Demo data only.

## Rules

- Every job starts with step-security/harden-runner on a pinned SHA,
  egress-policy audit. Switch to block with an explicit allowlist if a job
  needs tighter egress.
- All actions pinned to commit SHA with a version comment. Dependabot
  (.github/dependabot.yml) bumps them weekly.
- No pull_request_target, no run steps on untrusted PR input, no secrets
  in logs.
- Every workflow stays manually triggerable through workflow_dispatch so
  a job can be re-run on demand without pushing a commit.
- permissions: blocks stay minimal per job. docker.yml needs id-token:
  write for cosign keyless signing, nothing else does.

## Images

- Prod image: docker/Dockerfile, node build stage into
  nginxinc/nginx-unprivileged. Both bases are pinned by digest.
- OCI labels come from build args VERSION/VCS_REF/BUILD_DATE plus
  metadata-action labels in docker.yml.
- Dev stack lives in docker/dev/ (Vite dev server + Prosody) and never
  ships.
