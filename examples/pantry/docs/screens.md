# Screens
Each screen is a function from its data to markup, drawn with `shared/ui.ts` in the styles of `design/tokens.ts`.

## 1. Sign in
`LoginScreen` asks for an email. Once the link is sent, it says where to look instead of showing the form again.

## 2. Onboarding
Three cards before the first recipe. An empty list says what to do next (`listOr()`) instead of staying blank.

## 3. Recipe list and detail
`RecipeList` shows recipes newest first; `RecipeDetail` scales the ingredients to the servings. Nutrition is per serving.

## 4. Shopping list
`ShoppingList` shows what is left to buy, then the basket. `addToList()` in `app/shopping/list.ts` adds a recipe's
ingredients; `mergeItems()` keeps one line per ingredient; `toggleItem()` checks one off and queues the edit.
