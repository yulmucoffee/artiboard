# Self-hosted boards

A self-hosted site keeps every project's board at `<site>/p/<project>`, on SQLite (one file: a laptop, a small server, a container) or on Supabase (Postgres, Vercel). People open the board in a browser; agents (Claude Code, Codex, any MCP client) use the site's `artiboard` MCP server at `<site>/mcp` with a personal token. The page is the same one the claude.ai artifact publishes, so everything in "Adapt" works the same way.

Tools: everyday work uses `board_start`, `board_claim`, `board_task`, `board_post` and, with a code map, `board_map`; `board_start` gives the board rules (how every board works, built into the site) and the project's rules (`meta/rules`), so a repository keeps no rules file. It also lists the tasks assigned to the agent's person (marked `<person> wrote last` where someone else posted last, so the agent opens that thread first; those in review on one line of keys; someone holding a great many sees the first 20 and how many more) and the ready work, checking readiness against the dependency tasks themselves (and repairing `waitingOn` in passing), so the list is right even when nobody has the page open. `board_post {task, status: "todo"}` releases a task for anyone. `board_post {tasks: [...], status, text}` changes several tasks in one write, all or none, such as finishing the reviews a deploy shipped. Setup and changes use `board_whoami`, `board_projects`, `board_create_project`, `board_get`, `board_query`, `board_batch`, `board_page` and `board_login_link`. All but `board_whoami`, `board_projects`, `board_create_project` and `board_login_link` take `project`.

## Code map

A self-hosted project can keep a code map of each repository it names: files, functions, classes, types, tables and doc headings, how they connect (imports, defines, calls, extends, mentions), and which files form a group. A person or an agent builds it from a checkout with no model calls, and it is uploaded to the board. Artifact boards have no map yet.

Build it from the repository's root:

```bash
node <skill directory>/scripts/codemap.mjs --site <board url> --project <id> --repo owner/name [--root .] [--label api] [--token abt_…]
```

The skill directory is usually `~/.claude/skills/artiboard` or `.claude/skills/artiboard` (Claude Code), or `~/.codex/skills/artiboard` (Codex). The token also comes from `ARTIBOARD_TOKEN`, the same token the MCP server uses. `--label` names the map when `meta/config.repos` gives the repository no label. Rebuild after large changes: the map says when it was built and by whom. A site admin can build on the server instead, with `artiboard map build --project <id> --repo owner/name --root <checkout>`. The upload is gzipped, which fits most repositories; some hosts cap request sizes (about 4.5 MB on a common serverless host).

What agents get:

- `board_start` prints `code map: <repo> · N symbols · built MM-DD by <who>` for each map.
- `board_claim` and `board_task` add a `code:` section: the files and symbols the task's spec names, with how many symbols each defines and how many files depend on it. An `overlap` line follows when another open task touches the same code, such as `overlap M1-4 ↔ M1-6 (ben): shared/units.ts`.

`board_map` answers one question at a time, in short lines. It knows names and structure, not text: grep for a string or a flag it does not know, and open a symbol's lines when its role matters.

- `explain`: `board_map {project, explain: "parseConfig"}` shows where a name is, what it defines, imports, calls and is called by. `[x]` marks an edge read from the source; `[i]` marks one inferred by name.
- `file`: `board_map {project, file: "src/api/users.ts"}` shows the file's symbols, its imports and who imports it.
- `path`: `board_map {project, path: ["src/api/users.ts", "src/db/users.ts"]}` shows how two things connect.
- `query`: `board_map {project, query: "login rate limit"}` lists the files, symbols and docs a question touches.
- `impact`: `board_map {project, impact: "src/db/users.ts"}` lists what depends on it, to two hops: what breaks if it changes.
- `inside`: `board_map {project, inside: "createUser"}` lists what it calls and uses, to two hops: what it needs to work.
- No question: an overview of the groups and the most connected names.

Record what your work touches with `board_post {task, touches: [...]}`. The tool takes "Files or symbols you touch, added to the list; "" clears". The answer, and both holders' next `board_start`, show the overlaps: two open tasks that touch the same file, or files one import apart.

Limits:

- Extraction is deterministic and line-based, not a compiler. Calls match by name, so a common name can point at the wrong definition; such edges are marked `[i]`.
- Languages: JavaScript and TypeScript, Python, Go, Rust, Java, Kotlin, C#, Swift, Ruby, PHP, C/C++, SQL and Markdown.
- A stale map misleads. Rebuild after large changes.
- An admin can drop a map with `artiboard map drop --project <id> --repo <label>`.

## Connect

`board_whoami` answers with the person, access level, site URL and backend. If the `artiboard` tools are missing:

- **The team has a site.** The user needs a token from a site admin (the **Members** panel on the site's projects page, or `artiboard member add` / `member token` at the command line), then runs one of these and restarts the agent:
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

1. `board_projects` lists each project with its repositories. If this repository (its `git remote get-url origin`) is on none, ask whether it joins an existing project or gets a new one. New: ask for a title and a short lowercase id, then `board_create_project` with `repos` (this repository, plus others the project spans, each with a short label when there are several) and `lang` if the team's language is not the site default. Existing: add the repository to that project's `meta/config.repos` (`board_get`, then `update` with `if_version`; people can also do it from the page's Settings). Every member starts on a new project; a site admin trims `meta/config.people` if asked (`artiboard member remove`, or an admin's agent).
2. Draft tasks as in SKILL.md "Read the project, then draft" (key, title, feature, deps, spec, acceptance), show the table and wait for a yes. Find keys already used with `board_query tasks` where `milestone == "<M>"`, `fields: ["key"]`, limit 200. Then `board_batch`, at most 100 writes per call, `if_absent: true` on each, no null fields:

   ```json
   {"op":"set","path":"tasks/M1-3","if_absent":true,"data":{"key":"M1-3","title":"…","feature":"…","milestone":"M1","status":"todo","deps":["M1-1"],"waitingOn":["M1-1"],"start":"2026-10-30","due":"2026-11-02","repo":"api","updatedAt":"<ISO>"}}
   {"op":"set","path":"details/M1-3","if_absent":true,"data":{"spec":"docs/api.md §2","acceptance":"…"}}
   ```

   `waitingOn` = deps not done. `start` and `due` (`YYYY-MM-DD`) only when the plan names those days; `repo` (a label from `meta/config.repos`) when the project spans several repositories. Leave out what does not apply. Post one notice with `board_post {project, text}`. For a new milestone, also update `meta/config.milestone` (`board_get`, then `update` with `if_version`).
3. A new project's rules: draft `meta/rules` from `references/project-rules.md` in the board's language, show it, and write it on a yes (`{text, rev: 1, by, updatedAt}`). Only this project's own agreements go in; the board rules come with the site and are never copied.
4. Add the pointer block to `CLAUDE.md` for Claude Code and to `AGENTS.md` for Codex: both when the team uses both, otherwise whichever the repo has (create `AGENTS.md` if Codex is used and it is missing). Replace any existing block between the markers, and delete an older `docs/artiboard.md` (move any project agreement it holds to `meta/rules` first, with the user's yes):

   ```markdown
   <!-- artiboard:start -->
   ## Task board
   Tasks, threads and notices: <site>/p/<project> (MCP `artiboard`). For board work (finding, claiming, continuing or finishing a task, posting a notice), call `board_start {project: "<project>"}` first: it gives the board rules, this project's rules and your work.
   <!-- artiboard:end -->
   ```

5. Check with `board_start {project, ready: 50, peek: true}`: the ready list should be exactly the tasks with no unfinished deps, and the project rules print under the board rules. Commit and push only when the user asks.

## Adapt

Same rules as the artifact board (SKILL.md "Adapt to the project"):

- **Title, subtitle, milestone label, language, any UI string:** `board_get meta/config`, then `board_batch` `update` with `if_version`. Strings go in `meta/config.strings` (keys of the page's `I18N.en`). The page updates live.
- **People:** only site admins change who is on a board (`meta/config.people`, `people/`), with `artiboard member join` or `member remove`, or an admin's agent with `board_batch`. A member's agent gets `permission_denied`: ask an admin. Messages and notices must carry your own person as `author`, and a member changes or deletes only their own; a member moves only their own `cursors/<person>`.
- **Repositories:** `meta/config.repos` (`[{repo: "owner/name", label?}]`), from the page's Settings, `board_batch`, or `artiboard project repos --id <id> --repos a/b,c/d`. Agents find a project from their git remote with `board_start {repo}`.
- **Project rules and notes:** people edit both on the page. An agent changes them only when its person asks: one `board_batch` with `meta/rules` (or `meta/notes`) `{text, rev + 1, by, updatedAt}` and, for rules, one notice. The site refuses board-tool instructions in them: the board rules are artiboard's.
- **An older board** whose `meta/protocol` mixes board rules, project agreements and status: draft `meta/rules` (the project's own agreements) and `meta/notes` (schedule, where things stand, open questions) from it, drop everything that only restates how the board works, show both to the user, then write them and delete `meta/protocol` in one batch. Do the same for the repository's `docs/artiboard.md` (step 4 of Setup).
- **The page itself** (a status, a field on screen, a view), admins only, and only where the site sets `ARTIBOARD_AGENT_PAGE_EDITS=1` (page code runs for every member, so by default agents only read pages). Elsewhere, write the changed page to a file in the scratchpad and ask a site admin to run `artiboard page set --project <id> --file <file>`. Where it is on: `board_page {project}` gives the version; `board_page {project, find: "<text>"}` shows numbered lines around a match, so read only what you change; then `board_page {project, edits: [{old, new}], if_version}` with exact, unique `old` text. Change `STATUS`, its color in `BAR_COLORS`, a `.state.<name>{--sc:<color>}` CSS rule and the `st_<name>` strings together, exactly as for the artifact page, then say in `meta/rules` when the new status is used. The new page is served at once; `board_page {project, reset: true}` goes back to the bundled page. A member who is not an admin gets `permission_denied`: ask a site admin.

## Upgrade

The bundled page and the server update together when the site's code is updated (`git pull` in the source checkout and restart, a new image, or a new Vercel deploy). On Supabase, apply new files in `supabase/migrations` with `supabase db push` before the new code runs; SQLite updates itself on start. A project with its own page keeps it: read the changes in `skills/artiboard/assets/board.html` since its version, apply the ones the user wants with `board_page edits`, and keep the project's own changes. Rules files from older versions keep working; rewrite them from the template to get the newer, shorter rules.

## Move a claude.ai artifact board here

1. With ArtifactData, read the artifact board's documents: `meta/config`, `meta/rules`, `meta/notes`, every `tasks`, `details` and `notices` document, `cursors`, and the `messages` of each task (`tasks/<id>/messages`). Leave out `people/` (it links claude.ai accounts, which mean nothing here) and `meta/protocol` (fold anything project-specific in it into `meta/rules` first).
2. Write them to one JSON file, `{"<path>": data, …}`, in the scratchpad, never in the repository.
3. A site admin runs `artiboard project add --id <id> --title <title>` and then `artiboard import --project <id> --file <file> [--map old=new,…]`. `--map` renames people whose ids differ on the site; people who are site members are linked to their accounts.
4. Delete `docs/artiboard.md` (the site gives agents the board rules) and replace the pointer blocks as in Setup step 4. The artifact stays as it was; tell the user they can delete it once the team has moved.

## Sign-in link

`board_login_link` gives a one-time browser link (an hour, one use) for the agent's own person. Give it to the user in the chat only; never write it anywhere else.

## Site admin (outside the agent's tools)

Admins manage members on the site's projects page (**Members**: add, new token, sign-in link, access, revoke, remove) or with `artiboard` commands (`node server/cli.js …` in the source checkout, `docker compose exec board node server/cli.js …` in a container, or with `--env <file>` holding the Supabase keys): `member add|token|link|revoke|access|join|remove|list`, `project add|repos|drop|list`, `page show|set|reset`, `import`. Everyone sets their own display name and role in **Profile** there; it shows on every board they sit on. Only admins change `people/` and `meta/config.people`; access levels are `admin`, `member` (writes) and `viewer` (reads). `member revoke` also signs that member out of every browser.
