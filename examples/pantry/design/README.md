# Design
Colors, spacing and type sizes live in `design/tokens.ts` and nowhere else. `stylesheet()` in `shared/ui.ts` turns
them into the app's one stylesheet, so a screen names a class and never a size or a color.

## Dark mode
`palette()` picks the light or dark palette from the person's choice, else the phone's appearance. `themeVars()`
writes it as CSS variables, which the stylesheet uses by name (`var(--accent)`).

## Sizes
Body text is 17 points, the platform's default, so it follows the phone's text size setting. Spacing uses the five
steps in `space` and nothing between them.
