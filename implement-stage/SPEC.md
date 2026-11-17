# Specification — Activity total loading spinners

## Target

Replace the dashboard activity totals' initial em-dash placeholders with accessible animated loading indicators.

## Inputs

- Existing dashboard markup and activity refresh flow in `apps/web/src/main.ts`.
- Existing visual system in `apps/web/src/styles.css`.

## Outputs

- Four spinner placeholders rendered before the first activity response.
- Existing numeric totals preserved after the first successful load, including during quiet refreshes.
- Accessible loading text and reduced-motion behavior.

## Success command

`npm run check`

## Base commit

`ca3f6c68e5a9e0cefa7c22400446dbf5dc46f26e`

## Scope cuts

- No redesign of the activity cards or feed.
- No new loading library or image asset.
- No spinner replacement for unrelated dashboard sections.
