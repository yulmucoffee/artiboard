# Self-hosted boards

A self-hosted site keeps every project's board at `<site>/p/<project>`, on SQLite (one file: a laptop, a small server, a container) or on Supabase (Postgres, Vercel). People open the board in a browser; agents (Claude Code, Codex, any MCP client) use the site's `artiboard` MCP server at `<site>/mcp` with a personal token. The page is the same one the claude.ai artifact publishes, so everything in "Adapt" works the same way.

Tools: everyday work uses `board_start`, `board_claim`, `board_task`, `board_post` (the rules file says how). Setup and changes use `board_whoami`, `board_projects`, `board_create_project`, `board_get`, `board_query`, `board_batch`, `board_page` and `board_login_link`. All but `board_whoami`, `board_projects`, `board_create_project` and `board_login_link` take `project`.

## Connect

`board_whoami` answers with the person, access level, site URL and backend. If the `artiboard` tools are missing:

- **The team has a site.** The user needs a token from a site admin (`artiboard member add` or `member token` prints one), then runs one of these and restarts the agent:
  - Claude Code: `claude mcp add --scope user --transport http artiboard <site>/mcp --header "Authorization: Bearer <token>"`
  - Codex: `export ARTIBOARD_TOKEN=<token>` in the shell profile, then `codex mcp add artiboard --url <site>/mcp --bearer-token-env-var ARTIBOARD_TOKEN`
  Never put a token in a repository file, a commit or the board. The user pastes it into their own terminal.
  Codex asks before each `board_batch` and `board_page` call (they can overwrite documents). If the user wants `board_batch` to run without asking, they add `[mcp_servers.artiboard.tools.board_batch]` with `approval_mode = "approve"` to `~/.codex/config.toml` themselves.
- **No site yet.** Offer to start one on this computer (below). For a team domain, point the user to the README's "Self-host" section: Docker with Caddy for SQLite, or Vercel with Supabase.

## Start a site on this computer

The skill's source checkout (`$HOME/.artiboard/src`, from the install) holds the server. With the user's go-ahead:

```bash
cd "$HOME/.artiboard/src" && npm install --omit=dev
```

```bash
node "$HOME/.artiboard/src/server/cli.js" init --person <id> --name <name>
```

`init` makes the first admin and prints the token with both connect commands. Ask the user to run `node "$HOME/.artiboard/src/server/cli.js" serve` in a terminal they keep open (it serves `http://localhost:4100`; `--host 0.0.0.0` lets teammates on the same network in, with `BOARD_URL` set to the address they use). Teammates get their own tokens from `member add --person <id>`. Settings are environment variables: `ARTIBOARD_DB` (the SQLite file, default `~/.artiboard/board.db`), `PORT`, `HOST`, `BOARD_URL`, `ARTIBOARD_SITE` (the name on screens), `ARTIBOARD_LANG` (`en` or `ko`).

## Setup: put this repository on a board

1. `board_projects`. If the repo's project is missing, ask for a title and a short lowercase id, then `board_create_project` (with `lang` if the team's language is not the site default). Every member starts on it; a site admin trims `meta/config.people` if asked (`artiboard member remove`, or an admin's agent).
2. Draft tasks as in SKILL.md "Read the project, then draft" (key, title, feature, deps, spec, acceptance), show the table and wait for a yes. Find keys already used with `board_query tasks` where `milestone == "<M>"`, `fields: ["key"]`, limit 200. Then `board_batch`, at most 100 writes per call, `if_absent: true` on each, no null fields:

   ```json
   {"op":"set","path":"tasks/M1-3","if_absent":true,"data":{"key":"M1-3","title":"…","feature":"…","milestone":"M1","status":"todo","deps":["M1-1"],"waitingOn":["M1-1"],"updatedAt":"<ISO>"}}
   {"op":"set","path":"details/M1-3","if_absent":true,"data":{"spec":"docs/api.md §2","acceptance":"…"}}
   ```

   `waitingOn` = deps not done. Post one notice with `board_post {project, text}`. For a new milestone, also update `meta/config.milestone` (`board_get`, then `update` with `if_version`).
3. Fill `references/protocol-hosted.md` in the board's language and write it to `docs/artiboard.md`. Replace every `{{…}}`; `{{BOARD_URL}}` is the `site` from `board_whoami`. An older `docs/artiboard.md` is replaced the same way; keep its repo-specific lines.
4. Add the pointer block to `CLAUDE.md` for Claude Code and to `AGENTS.md` for Codex: both when the team uses both, otherwise whichever the repo has (create `AGENTS.md` if Codex is used and it is missing). Replace any existing block between the markers:

   ```markdown
   <!-- artiboard:start -->
   ## Task board
   Tasks, threads and notices: <site>/p/<project> (MCP `artiboard`, project `<project>`). For board work (finding, claiming, continuing or finishing a task, posting a notice), read `docs/artiboard.md` first and follow it.
   <!-- artiboard:end -->
   ```

5. Check with `board_start {project, ready: 50, peek: true}`: the ready list should be exactly the tasks with no unfinished deps. Commit and push only when the user asks.

## Adapt

Same rules as the artifact board (SKILL.md "Adapt to the project"):

- **Title, subtitle, milestone label, language, any UI string:** `board_get meta/config`, then `board_batch` `update` with `if_version`. Strings go in `meta/config.strings` (keys of the page's `I18N.en`). The page updates live.
- **People:** only site admins change who is on a board (`meta/config.people`, `people/`), with `artiboard member join` or `member remove`, or an admin's agent with `board_batch`. A member's agent gets `permission_denied`: ask an admin. Messages and notices must carry your own person as `author`.
- **Rules:** edit `docs/artiboard.md`, update `meta/protocol` (`text`, `rev` + 1) and post one notice, together.
- **The page itself** (a status, a field on screen, a view), admins only, and only where the site sets `ARTIBOARD_AGENT_PAGE_EDITS=1` (page code runs for every member, so by default agents only read pages). Elsewhere, write the changed page to a file in the scratchpad and ask a site admin to run `artiboard page set --project <id> --file <file>`. Where it is on: `board_page {project}` gives the version; `board_page {project, find: "<text>"}` shows numbered lines around a match, so read only what you change; then `board_page {project, edits: [{old, new}], if_version}` with exact, unique `old` text. Change `STATUS`, `BAR`, the `.state.<name>` CSS rule and the `st_<name>` strings together, exactly as for the artifact page, then the rules file. The new page is served at once; `board_page {project, reset: true}` goes back to the bundled page. A member who is not an admin gets `permission_denied`: ask a site admin.

## Upgrade

The bundled page and the server update together when the site's code is updated (`git pull` in the source checkout and restart, a new image, or a new Vercel deploy). A project with its own page keeps it: read the changes in `skills/artiboard/assets/board.html` since its version, apply the ones the user wants with `board_page edits`, and keep the project's own changes. Rules files from older versions keep working; rewrite them from the template to get the newer, shorter rules.

## Move a claude.ai artifact board here

1. With ArtifactData, read the artifact board's documents: `meta/config`, `meta/protocol`, every `tasks`, `details` and `notices` document, `cursors`, and the `messages` of each task (`tasks/<id>/messages`). Leave out `people/` (it links claude.ai accounts, which mean nothing here).
2. Write them to one JSON file, `{"<path>": data, …}`, in the scratchpad, never in the repository.
3. A site admin runs `artiboard project add --id <id> --title <title>` and then `artiboard import --project <id> --file <file> [--map old=new,…]`. `--map` renames people whose ids differ on the site; people who are site members are linked to their accounts.
4. Rewrite `docs/artiboard.md` from `references/protocol-hosted.md` and replace the pointer blocks. The artifact stays as it was; tell the user they can delete it once the team has moved.

## Sign-in link

`board_login_link` gives a one-time browser link (an hour, one use) for the agent's own person. Give it to the user in the chat only; never write it anywhere else.

## Site admin (outside the agent's tools)

Admins manage the site with `artiboard` commands (`node server/cli.js …` in the source checkout, `docker compose exec board node server/cli.js …` in a container, or with `--env <file>` holding the Supabase keys): `member add|token|link|revoke|access|join|remove|list`, `project add|drop|list`, `page show|set|reset`, `import`. Only admins change `people/` and `meta/config.people`; access levels are `admin`, `member` (writes) and `viewer` (reads). `member revoke` also signs that member out of every browser.
