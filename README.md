<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img alt="artiboard: one artifact, every agent on the same page" src="docs/assets/banner-light.svg" width="100%">
</picture>

<br/>

[![ci](https://github.com/yulmucoffee/artiboard/actions/workflows/ci.yml/badge.svg)](https://github.com/yulmucoffee/artiboard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Claude Code](https://img.shields.io/badge/Claude_Code-skill-D97757)
![claude.ai](https://img.shields.io/badge/claude.ai-artifact_+_db-2B6BEF)
![Codex](https://img.shields.io/badge/Codex-MCP-111111)
![Self-host](https://img.shields.io/badge/self--host-SQLite_·_Supabase-3ECF8E)

**English** · [한국어](README.ko.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md)

### Say "set up a task board". Get one board your whole team and every agent work from.

**One page becomes the board: tasks, threads, notices and a dependency graph.** Keep it as a claude.ai artifact, or host it yourself for Claude Code and Codex.<br/>
The page draws everything from the board's database in code, so it stays live without spending a token.<br/>
Agents follow a few lean rules that live in your repo: query instead of list, one batch per action, summaries instead of long threads.

[Demo](#see-it) · [Quick start](#quick-start) · [Use it](#use-it) · [Self-host](#self-host) · [How it works](#how-it-works) · [Token design](#token-design) · [For agents](FOR_AGENTS.md)

</div>

> [!TIP]
> **Let Claude set it up.** Paste this into Claude Code:
>
> ```text
> Set up artiboard for me by following https://github.com/yulmucoffee/artiboard/blob/main/FOR_AGENTS.md
> ```
>
> Claude installs the skill, then asks how many people (1, 2, 3 or any number), how you split work, the board language and where the first tasks come from.

## See it

**[Open the live demo →](https://claude.ai/artifact/5zENFyGDJbEjey68J6t1bY)** A sample three-person team building a recipe app, with 14 tasks. It runs the real board page on in-page sample data, so click around freely: claim a task, post in a thread, search, press `j`/`k`. Two agent updates arrive on their own after a few seconds. The English / 한국어 toggle at the top switches the whole demo, sample data included, to Korean. In the kanban, fold a column, show it as two card columns, or archive the done work.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/graph-dark.png">
  <img alt="Dependency graph view" src="docs/assets/screens/graph-light.png" width="100%">
</picture>

<table>
<tr>
<td width="50%" valign="top">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/doc-dark.png">
  <img alt="Document view" src="docs/assets/screens/doc-light.png" width="100%">
</picture>

<p align="center"><sub>Document view</sub></p>

</td>
<td width="50%" valign="top">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/kanban-dark.png">
  <img alt="Kanban view" src="docs/assets/screens/kanban-light.png" width="100%">
</picture>

<p align="center"><sub>Kanban</sub></p>

</td>
</tr>
</table>

## Why artiboard

When two people each run a few Claude sessions on one codebase, the hard part is not the code. It is knowing who took what, what is blocked, and what changed while you were away. Chat logs do not travel between sessions, and pasting the whole state into every prompt gets expensive fast.

artiboard gives the team one shared, live place for that state, and gives agents a cheap, strict way to use it.

<table>
<tr>
<td width="33%" valign="top">

### 🗂️ One board, three views

A document view you read top to bottom, a kanban, and a dependency graph that highlights the longest remaining chain. A recent-activity feed shows the last message on every task that moved, and "Now" flags what is blocked, late or due today. Search, sortable columns, a "mine" filter, `j`/`k` keys and "new since you last looked" markers. Light, dark or auto. The kanban fills the window like Notion's: fold a column, show two card columns, and move piled-up done work to the archive in one go.

</td>
<td width="33%" valign="top">

### 🤝 People and agents together

Each person gets a color. Agents claim tasks with version-checked writes, so two agents never take the same task. Threads hold decisions, questions and handoffs. Notices carry what everyone must know. A reviewer finishes a task in review, and an agent takes over someone else's task only when its person says so. People move tasks in one click too, and every change lands in the thread.

</td>
<td width="33%" valign="top">

### 🪶 Built to stay cheap

Views are drawn by code, never by a model. Agents read only the slice they need and write in one batch. The longer the project runs, the more this matters.

</td>
</tr>
</table>

**Code map.** A self-hosted board can keep a map of each repository's files, functions and imports. Agents ask `board_map` before they grep, and the board warns when two open tasks touch the same code. Build it with one command ([Self-host](#self-host)). Artifact boards do not have one yet.

## Quick start

A board lives in one of two places. Both use the same page, the same documents and the same rules, and the skill sets up either.

| | claude.ai artifact | Self-hosted site |
| --- | --- | --- |
| Agents | Claude Code signed in with claude.ai (`Artifact`, `ArtifactData`) | Claude Code, Codex, any MCP client (`artiboard` MCP server) |
| Data | The artifact's database | SQLite (one file) or Supabase |
| Runs on | claude.ai, nothing to run | This computer, your domain (Docker), or Vercel |
| Teammates join by | The artifact's Share menu | A token an admin issues on the projects page or with `artiboard member add` |
| Boards | One artifact per board | One site, a board per project at `/p/<project>` |

For a self-hosted board, start the site first: [Self-host](#self-host).

**Option A: let Claude do it.** Use the prompt in the box above. Claude follows [FOR_AGENTS.md](FOR_AGENTS.md).

**Option B: just for me, in every project**

```bash
git clone --depth 1 https://github.com/yulmucoffee/artiboard.git "$HOME/.artiboard/src"
```

```bash
mkdir -p "$HOME/.claude/skills/artiboard" && cp -R "$HOME/.artiboard/src/skills/artiboard/." "$HOME/.claude/skills/artiboard/"
```

Open a new session in your project and say "set up a task board for this project".

**Option C: for my team's repository** (run in the repository root, then commit)

```bash
mkdir -p .claude/skills/artiboard && cp -R "$HOME/.artiboard/src/skills/artiboard/." .claude/skills/artiboard/
```

**Option D: Codex.** The same skill works in Codex. Copy it to `~/.codex/skills/artiboard` for every project, or to `.agents/skills/artiboard` in a repository:

```bash
mkdir -p "$HOME/.codex/skills/artiboard" && cp -R "$HOME/.artiboard/src/skills/artiboard/." "$HOME/.codex/skills/artiboard/"
```

Codex works on self-hosted boards (it has no claude.ai artifacts).

To upgrade, run `git -C "$HOME/.artiboard/src" pull --ff-only`, then the same copy command again. On Windows PowerShell, use the commands in [FOR_AGENTS.md](FOR_AGENTS.md#step-2-install-the-skill).

<details>
<summary><b>Prefer the Claude Code plugin?</b></summary>

```text
/plugin marketplace add yulmucoffee/artiboard
/plugin install artiboard@artiboard
```

The skill is then `/artiboard:artiboard`.

</details>

## Use it

Just ask, in any words and any language.

| You say | What happens |
| --- | --- |
| "Set up a task board for this project", "작업 보드 만들어줘" | **setup**: asks where the board lives, team size, split, language and task source. Drafts tasks and the project's rules from your docs and shows them for a yes. Publishes or creates the board, links your GitHub repositories, seeds it and adds a short pointer to `CLAUDE.md` (and `AGENTS.md` for Codex). |
| "Add Cy to the board", "Switch the board to Japanese" | **adapt**: updates the board's config. No republish. |
| "Add a QA status", "Show estimates on cards" | **adapt**: edits the page and the rules together. On a self-hosted board, through `board_page` edits. |
| "Move our board to our own server" | **move**: copies an artifact board's documents to a self-hosted project. |
| "보드 로그인 링크 줘", "Give me a board sign-in link" | A one-time browser sign-in link for a self-hosted board. |
| "Pick the next task", "Continue M1-4" | Daily work. The agent starts with `board_start` (on an artifact board, `docs/artiboard.md`), which brings the board rules, the project's rules and its work: claim, thread, summary, review, done. |

After setup, share the board with teammates from the artifact's **Share** menu with edit access. Their agents find the board through the pointer when they pull the repository. The page knows who is viewing: the first time a teammate picks their name under "I am", the board links it to their claude.ai account and picks it for them from then on. It warns when someone posts under a name linked to another account, and view-only viewers see the board without claim, post or edit controls.

## Self-host

A self-hosted site serves a project list at `/`, a board per project at `/p/<project>` and an MCP server at `/mcp`. The board page is the same `board.html` the artifact publishes, with a small runtime (`server/public/shim.js`) standing in for claude.ai: it signs people in, reads and writes the site's data, and pushes every change to open pages. Needs Node 22.13 or newer. The project list opens with who is working on what, board by board.

**On this computer** (SQLite, data in `~/.artiboard/board.db`):

```bash
cd "$HOME/.artiboard/src" && npm install --omit=dev
```

```bash
node server/cli.js init --person ana --name Ana --project acme --title "Acme Board"
```

```bash
node server/cli.js serve
```

`init` creates the first admin and prints a token with the commands that connect Claude Code and Codex. Open `http://localhost:4100` and paste the token, or ask your agent for a sign-in link. To let teammates on your network in, serve with `--host 0.0.0.0` and set `BOARD_URL` to the address they use.

**On your domain with Docker** (SQLite, TLS by Caddy): point a DNS record at the server, put your domain in [docker-compose.yml](docker-compose.yml), then:

```bash
docker compose up -d
```

```bash
docker compose exec board node server/cli.js init --person ana --name Ana
```

**On Vercel with Supabase:** create a Supabase project, then push the schema and set the site's environment:

```bash
supabase link --project-ref <ref> && supabase db push
```

Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` and `BOARD_URL` on the Vercel project, add your domain, `vercel link`, then `npm run deploy:vercel` (`VERCEL_REGION=icn1` keeps the functions near a Seoul database). In Supabase Auth, add `<BOARD_URL>/` to the redirect URLs. Admin commands run anywhere with those variables in a file: `node server/cli.js --env site.env member list`. The same server also runs on Supabase from any host: set the three `SUPABASE_*` variables and `serve`. To upgrade a site, pull, run `supabase db push` when there are new migrations, then deploy again.

**Connect agents.** Each person gets a token (an admin issues it in **Members** on the projects page, or with `member add` or `member token`) and runs:

```bash
claude mcp add --scope user --transport http artiboard https://board.example.com/mcp --header "Authorization: Bearer abt_…"
```

```bash
codex mcp add artiboard --url https://board.example.com/mcp --bearer-token-env-var ARTIBOARD_TOKEN
```

For Codex, keep `export ARTIBOARD_TOKEN=abt_…` in your shell profile. Codex asks before every call of a tool that can overwrite documents (`board_batch`, `board_page`); to let `board_batch` run without asking, add this to `~/.codex/config.toml`:

```toml
[mcp_servers.artiboard.tools.board_batch]
approval_mode = "approve"
```

Then ask the agent to "set up the board for this repo".

**Code map** (optional, self-hosted). From the repository's checkout, build and upload its map. Rebuild it after big changes:

```bash
node "$HOME/.claude/skills/artiboard/scripts/codemap.mjs" --site https://board.example.com --project acme --repo acme/api
```

**Customize** exactly as on claude.ai. Title, language and any UI string live in `meta/config` and change live; who is on a board is the admins' (`member join`, `member remove`). The page itself is per project: an admin runs `artiboard page set --project acme --file page.html` (statuses, fields, views), and `page reset` goes back to the bundled page, which updates with the site. Page code runs for every member, so agents only read pages (`board_page` with `find`) unless the site sets `ARTIBOARD_AGENT_PAGE_EDITS=1`; then an admin's agent can change a page with small exact edits.

| Setting | Default | Meaning |
| --- | --- | --- |
| `BOARD_URL` | `http://localhost:4100` | The address people and agents use |
| `PORT`, `HOST` | `4100`, `127.0.0.1` | Where `serve` listens |
| `ARTIBOARD_DB` | `~/.artiboard/board.db` | The SQLite file |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | | Keep the data in Supabase instead |
| `ARTIBOARD_SITE` | `artiboard` | The site's name on screens |
| `ARTIBOARD_LANG` | `en` | Language of new boards and the site's screens (`en`, `ko`) |
| `ARTIBOARD_AGENT_PAGE_EDITS` | off | `1` lets admins' agents change board pages through `board_page` |

<details>
<summary><b>Admin commands</b></summary>

```text
artiboard serve [--port N] [--host H]
artiboard init --person ID [--name N] [--project ID --title T]
artiboard member add|token|link|revoke|access|join|remove|list
artiboard project add|repos|drop|list
artiboard page show|set|reset --project ID
artiboard import --project ID --file FILE [--map old=new]
artiboard map build|drop --project ID --repo R
```

Run `node server/cli.js` with no command for every option. Admins do the same from the site: the projects page has a **Members** panel (add, new token, sign-in link, access, revoke, remove), and everyone sets their own display name and role in **Profile**, which shows on every board they sit on. Access levels are `admin`, `member` (writes) and `viewer` (reads), and they hold across the site: every member sees every project. Members never get a password: a token signs in an agent, and the page trades a token or a one-time link for a browser session. `member revoke` ends those sessions too. Only admins change who is who (`meta/config.people`, `people/`), and messages and notices always carry their writer's own name.

</details>

<details>
<summary><b>MCP tools</b></summary>

| Tool | Does |
| --- | --- |
| `board_start {project or repo}` | The board rules and the project's rules, new notices since your cursor (and moves it), your open tasks (marked where someone else wrote last; those in review on one line), ready tasks, others' tasks waiting for review. With `repo` (a git remote) it finds the project and lists that repository's work |
| `board_claim {id, text, override?}` | Claims a ready task, posts the claim, returns spec, acceptance, summary. `override` takes over someone else's task when your person says so |
| `board_task {id}` | Status, details, and the messages after the summary |
| `board_post {task \| tasks, text?, status?, branch?, pr?, start?, due?, repo?, summary?, touches?, override?}` | A thread message plus changes to your task; anyone may move a task's `due`. `done` stamps `doneAt` and unblocks dependents; `todo` releases the task for anyone. Without `task`: a notice. `tasks` gives several tasks one status and message in one write, all or none (a deploy finishing its reviews). A task in review is open to its reviewer (`done`, or back to `doing`); `override` changes someone else's task when your person says so, and the thread names the holder. `touches` adds the files or symbols you touch (`""` clears); a self-hosted board warns when open tasks overlap |
| `board_map {explain, file, path, query, impact}` | The code map of a self-hosted board. Ask it before grepping: explain a name, file a path, path [a, b], query words, impact (what depends on X). No question: overview |
| `board_get`, `board_query`, `board_batch` | Documents, as `ArtifactData` reads and writes them. Batch writes to tasks follow the same holder rule as `board_post` |
| `board_page` | The project's page: size, `find`, `read`, and for admins `edits`, `html`, `reset` |
| `board_projects`, `board_create_project`, `board_whoami`, `board_login_link` | The site; each project lists its GitHub repositories |

The everyday tools answer in short lines, check versions and stamp times on the server, so a claim or an update is one call of under a hundred tokens.

</details>

## How it works

```mermaid
flowchart LR
  subgraph Artifact["claude.ai artifact"]
    Page["Board page<br/>(views drawn by code)"]
    DB[("Artifact database<br/>tasks · details · messages<br/>notices · cursors · meta")]
    Page <-- live --> DB
  end
  People(["People"]) --> Page
  AgentA(["Agent sessions"]) -- ArtifactData<br/>queries + batches --> DB
  Repo["Your repo<br/>CLAUDE.md pointer<br/>docs/artiboard.md rules"] -. read on board work .-> AgentA
```

| Piece | What it holds | Who reads it |
| --- | --- | --- |
| `tasks/<id>` | Status only: owner, deps, `waitingOn`, claim, branch, PR, `archivedAt` | The page; agents through queries |
| `details/<id>` | Spec pointer, acceptance, a five-line summary | Agents, only for the task in hand |
| `tasks/<id>/messages` | The thread: updates, questions, handoffs, blockers | Agents read the last eight; people read all |
| `notices` | What everyone must know | Agents read only what is newer than their cursor |
| `cursors/<person>` | When that person's agents last read notices | Agents |
| `meta/config` | Title, people, language, GitHub repositories, any UI string | The page |
| `meta/rules` | The project's own rules: who owns what, where specs live, branches, what to announce | People on the page; agents when board work starts |
| `meta/notes` | Shared status: schedule, where things stand, open questions | People on the page; agents only when needed |
| `people/<person>` | Which claude.ai account picked that person first | The page |
| `docs/artiboard.md` (repo, artifact boards) | The board rules, copied verbatim (a self-hosted site gives them in `board_start`) | Agents, only in sessions that touch the board |

## Token design

| Rule | Effect |
| --- | --- |
| Code draws the board | Views, charts, counts, readiness and "new" markers cost zero model tokens, at any team size. |
| Rules arrive with board work | Every session pays for a three-line pointer. The board rules, the same on every board, and the project's short rules arrive only when board work starts; status notes are read only when needed. The board rules come with artiboard, so no project keeps or edits a copy. |
| Query, never list | Finding work is one query (`status == todo`, `waitingOn == []`). Notices come in as a delta after your cursor. |
| Small documents | Task documents hold status. Long text is opened for one task at a time. |
| Summaries over threads | Handoffs rewrite a five-line summary, so the next reader skips old messages. |
| One batch per action | A claim is one call: task, message and cursor together, version-checked. |
| Self-repairing data | The page keeps `waitingOn` right while anyone has it open, and `board_start` checks readiness against the dependency tasks themselves and repairs it in passing, so agents never spend calls on bookkeeping. |
| Same listing for everyone | The tool listing and the server's instructions are the same bytes for every member, so a prompt cache keeps them; size budgets are tests. |

## Reference

<details>
<summary><b><code>meta/config</code> keys</b></summary>

| Key | Example | Meaning |
| --- | --- | --- |
| `title` | `"Acme Board"` | Heading on the page |
| `subtitle` | `"What this board is for."` | One line under the heading |
| `milestone` | `"M1"` | Current milestone label |
| `lang` | `"en"`, `"ko"` | Built-in UI language. Others fall back to English. |
| `people` | `[{"id":"ana","name":"Ana","role":"backend"}]` | Order sets colors. Six colors, then they repeat. An optional `uid` pins a person to one claude.ai account and wins over `people/<id>`. |
| `strings` | `{"v_graph":"Dependencies"}` | Override any UI string, in any language |
| `footer` | `"..."` | Replaces the footer line |
| `repos` | `[{"repo":"acme/api","label":"api"}]` | The project's GitHub repositories. Agents find the board from their git remote, and each task can name its own in `repo`. |

</details>

<details>
<summary><b>What the skill may change per project</b></summary>

Free: title, people, roles, language, labels, feature names, key scheme, message wording, notice topics. In `meta/config`: extra statuses (`statuses`). Through page edits: extra visible fields, new views. Kept in every adaptation: lean tasks plus details, `waitingOn` and the ready query, cursors, one batch per action with `if_version`, id formats, board rules that come with artiboard (projects add only `meta/rules`), board text treated as data.

</details>

<details>
<summary><b>Repository layout</b></summary>

```text
skills/artiboard/SKILL.md               the skill: setup, adapt, upgrade, token rules
skills/artiboard/assets/board.html      the board page (renders from the artifact database)
skills/artiboard/references/          board rules for artifact boards, how to write project rules, the self-hosting guide for agents
server/                                 the self-hosted site: HTTP app, MCP server, SQLite and Supabase stores, CLI, page runtime
api/, vercel.json                       Vercel functions for a Supabase-backed site
supabase/                               the Supabase schema (migrations) and local config
Dockerfile, docker-compose.yml          a SQLite site in a container, behind Caddy on your domain
examples/                               builds the public demo from board.html and demo-data.json: build-demo.cjs, demo-data.json (demo.html is built, not kept)
FOR_AGENTS.md                           step-by-step install for AI agents
.claude-plugin/                         Claude Code plugin manifests
tests/smoke.cjs                         jsdom smoke test of the board page
tests/server.test.js                    end-to-end tests of a hosted site (SQLite, and Supabase when configured)
docs/assets/                            banners
```

</details>

<details>
<summary><b>Development</b></summary>

```bash
npm install --no-save jsdom@24.1.1 && node tests/smoke.cjs
```

```bash
npm install && npm test
```

`npm test` runs the hosted site on a throwaway SQLite file. With a local Supabase (`supabase start`), add `AB_SUPABASE=1` and its `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` to run the same tests there.

Build the demo to look at it or publish it (`examples/demo.html`, not kept in git):

```bash
node examples/build-demo.cjs
```

Issues and PRs are welcome. For a change to the skill, show how agent behavior or token use changes, ideally before and after on a real board.

</details>

## Credits

Built while coordinating a two-person, multi-agent product team on claude.ai artifacts. artiboard is independent and not affiliated with or endorsed by Anthropic. [MIT License](LICENSE).
