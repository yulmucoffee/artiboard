# Contributing

Every change that reaches `main`, through a pull request or a direct push, comes with two things:

1. **A version bump** in `package.json` (`npm version <x.y.z> --no-git-tag-version`, which also stamps the version into `server/version.js` and the skill's `SKILL.md`): a new feature raises the middle number (1.3.0 → 1.4.0), a fix or a docs change the last one (1.4.0 → 1.4.1). The first number stays 1; the middle one keeps counting past 9 (1.9.0 → 1.10.0).
2. **A changelog entry** at the top of `server/public/changelog.json` for that version: the date, the pull request numbers, and one to three short lines in English (`en`) and Korean (`ko`) that say what changed for the people using the board, not how. The project list shows these as "Updates".

```json
{ "version": "1.4.1", "date": "2026-10-23", "prs": [11], "lines": { "en": ["…"], "ko": ["…"] } }
```

`npm test` checks both: the newest entry must match the package version, versions go newest first, and each language has one to three lines. Keep entries free of any one site's names or data: this repository is public.

## Tokens and prompt caching

Agents pay for every token the board puts in their context, and every tool call is another model request that reads the whole context again. Prompt caching makes that re-read cheap only while the start of the context stays byte for byte the same. Changes to the MCP server keep to these rules:

1. **What every session reads is fixed per release.** The server instructions and the tool listing carry no member, project, time or count, so every member of a site gets the same bytes (a test checks). Tools are never registered per member and the server never sends `tools/list_changed`: a changed listing throws away the cache of everything after it.
2. **Each thing is said once per conversation.** The board rules come from `board_start` (on an artifact board, from `docs/artiboard.md`), never from tool descriptions or instructions, so a session that does no board work pays nothing for them. A second `board_start` in the same conversation passes `rules: false`. Project notes, which change daily, are pointed at, not printed.
3. **One call per action.** `board_claim` hands back spec, acceptance and summary; `board_post` carries text, status, PR and summary together; versions are checked on the server and times stamped there. A new everyday action is one tool call, not a read followed by a write.
4. **Lines, not documents.** The everyday tools answer in short lines without JSON keys, ids or nulls; a thread shows only the messages after its summary; lists have small defaults (8 ready tasks, 8 messages). The document tools drop null fields and take `fields`.
5. **Budgets are tests.** The tool listing stays under 7,200 characters and the board rules under 1,800; raise a budget only with a reason in the pull request.
