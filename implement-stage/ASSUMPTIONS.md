# Assumption Ledger — Activity total loading spinners
<!-- ASK mode: never -->

| ID | Under-determined by the request | Chosen | Class | Source |
|----|--------------------------------|--------|-------|--------|
| A-001 | Whether totals should return to loading state on every refresh | Show spinners only before the first response; retain loaded numbers during quiet refreshes | interface | default |
| A-002 | How loading is announced to assistive technology | Give each spinner an accessible `Loading` label while keeping the animation decorative | interface | default |
| A-003 | How animation behaves for reduced-motion users | Disable rotation and show a static ring under `prefers-reduced-motion: reduce` | interface | default |

## Notes

- **A-001** — Replacing numbers during the 15-second background refresh would create visible flicker and obscure useful cached totals. Reversing this would require setting the four totals back to loading in `refreshContractActivity`.
