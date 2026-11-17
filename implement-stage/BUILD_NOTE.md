# Build Note — Activity total loading spinners

| Rung | Feature | Acceptance check (ONE command) | Tier | Status |
|------|---------|--------------------------------|------|--------|
| F0 | Initial dashboard markup renders spinner placeholders | `npm run build -w @near-arcade/web` | MUST | ✅ |
| F1 | Spinner styling, accessible label, and reduced-motion behavior | `npm run typecheck -w @near-arcade/web` | MUST | ✅ |
| F2 | Loaded totals and refresh/error behavior remain regression-covered | `npm test -w @near-arcade/web` | MUST | ⬜ |

## Run record

- F0 — `npm run build -w @near-arcade/web` exited 0; `apps/web/dist` was produced. Fix attempts: 0.
- F1 — `npm run typecheck -w @near-arcade/web` exited 0; the earlier F0 build check also exited 0. Fix attempts: 0.

## Deferred

- None.

## Blockers

- None.
