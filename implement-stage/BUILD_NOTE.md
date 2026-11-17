# Build Note — Activity total loading spinners

| Rung | Feature | Acceptance check (ONE command) | Tier | Status |
|------|---------|--------------------------------|------|--------|
| F0 | Initial dashboard markup renders spinner placeholders | `npm run build -w @near-arcade/web` | MUST | ✅ |
| F1 | Spinner styling, accessible label, and reduced-motion behavior | `npm run typecheck -w @near-arcade/web` | MUST | ✅ |
| F2 | Loaded totals and refresh/error behavior remain regression-covered | `npm test -w @near-arcade/web` | MUST | ✅ |

## Run record

- F0 — `npm run build -w @near-arcade/web` exited 0; `apps/web/dist` was produced. Fix attempts: 0.
- F1 — `npm run typecheck -w @near-arcade/web` exited 0; the earlier F0 build check also exited 0. Fix attempts: 0.
- F2 — `npm test -w @near-arcade/web` exited 0 with 24 passing tests; the F0 build and F1 typecheck checks had also exited 0. Fix attempts: 0.
- Workspace — `npm run check` exited 0; all package typechecks, 79 tests, all builds, and the frontend secret scan passed.

## Deferred

- None.

## Blockers

- The fresh silent-assumption reviewer could not start because the Codex host's default `gpt-6-astra` route returned HTTP 503 with no available channel. `implement-stage/SILENT_ASSUMPTION_SWEEP.json` records `SWEEP_UNAVAILABLE`; no alternate provider was selected.
