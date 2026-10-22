# Contributing

Every change that reaches `main`, through a pull request or a direct push, comes with two things:

1. **A version bump** in `package.json` (`npm version <x.y.z> --no-git-tag-version`): a new feature raises the middle number (1.3.0 → 1.4.0), a fix or a docs change the last one (1.4.0 → 1.4.1).
2. **A changelog entry** at the top of `server/public/changelog.json` for that version: the date, the pull request numbers, and one to three short lines in English (`en`) and Korean (`ko`) that say what changed for the people using the board, not how. The project list shows these as "Updates".

```json
{ "version": "1.4.1", "date": "2026-10-23", "prs": [11], "lines": { "en": ["…"], "ko": ["…"] } }
```

`npm test` checks both: the newest entry must match the package version, versions go newest first, and each language has one to three lines. Keep entries free of any one site's names or data: this repository is public.
