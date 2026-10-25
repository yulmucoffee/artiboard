# API
One fetch handler, `makeHandler()` in `api/server.ts`. Every route but sign-in needs the session as a bearer token.
A route that fails answers `{ status, error }`.

## 1. Sign in
`POST /auth/link` and `POST /auth/verify`, in `api/routes/auth.ts`; the flow is in `docs/auth.md`.

## 2. Recipes
`GET /recipes` lists the household's recipes, newest first (`listRecipes()`). `GET /recipes/:id` is 404 for an id
from another household. `POST /recipes/import` reads a page's recipe data and saves it (`importRecipe()` in
`api/routes/recipes.ts`); 422 when the page has none.

## 3. Shopping lists
`GET` and `PUT /shopping/:list` answer with the whole list (`api/routes/shopping.ts`). `PUT /devices` keeps a push token.
