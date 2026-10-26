# Pocket Pantry
Recipes and a shared shopping list for a household, on every phone in it, online or not.

## Layout
- `app/`: the phone app. Recipes, the shopping list, sign-in, sync and notifications, one folder each.
- `api/`: the server. One fetch handler in `api/server.ts`; the tables are in `api/db/schema.sql`.
- `shared/`: code both sides use. `shared/units.ts` reads kitchen amounts and `shared/ui.ts` draws views.
- `design/`: the tokens every screen is drawn with (`design/README.md`).
- `docs/`: one spec per area. Start with `docs/screens.md` and `docs/api.md`.

## Checks
Run `shared/units.test.ts` with any TypeScript runner before opening a pull request.
