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

**One page is the board: tasks, threads, notices, a dependency graph and a code map.** Keep it as a claude.ai artifact, or host it yourself for Claude Code and Codex.<br/>
The page draws everything from the board's database in code, so it stays live without spending a token, and agents read and write it through a few lean rules.

[Install](#install) · [See it](#see-it) · [What you get](#what-you-get) · [Use it](#use-it) · [Self-host](#self-host) · [How it works](#how-it-works) · [For agents](FOR_AGENTS.md)

</div>

## Install

**Ask Claude.** Paste this into Claude Code; it installs the skill and asks how many people, how you split work, the board language and where the first tasks come from:

```text
Set up artiboard for me by following https://github.com/yulmucoffee/artiboard/blob/main/FOR_AGENTS.md
```

**Or copy the skill yourself.** Two commands, then say "set up a task board for this project" in a new session:

```bash
git clone --depth 1 https://github.com/yulmucoffee/artiboard.git "$HOME/.artiboard/src"
```

```bash
mkdir -p "$HOME/.claude/skills/artiboard" && cp -R "$HOME/.artiboard/src/skills/artiboard/." "$HOME/.claude/skills/artiboard/"
```

For Codex, copy to `$HOME/.codex/skills/artiboard` instead; for one repository, to `.claude/skills/artiboard` (or `.agents/skills/artiboard`) and commit. To upgrade, `git -C "$HOME/.artiboard/src" pull --ff-only` and copy again. Windows PowerShell commands are in [FOR_AGENTS.md](FOR_AGENTS.md#step-2-install-the-skill).

<details>
<summary><b>Prefer the Claude Code plugin?</b></summary>

```text
/plugin marketplace add yulmucoffee/artiboard
/plugin install artiboard@artiboard
```

The skill is then `/artiboard:artiboard`.

</details>

## See it

**[Open the live demo →](https://claude.ai/artifact/5zENFyGDJbEjey68J6t1bY)** A three-person team building a recipe app: the real board page on sample data, so claim a task, post in a thread, open the code map, switch to 한국어. Two agent updates arrive on their own.

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

## What you get

When a few people each run a few agent sessions on one codebase, the hard part is knowing who took what, what is blocked and what changed while you were away. artiboard is one live place for that, cheap for agents to use.

- **One board, three views.** A document you read top to bottom, a kanban, and a dependency graph that highlights the longest remaining chain. "Now" flags what is blocked, late or due today; search, a "mine" filter, `j`/`k` keys, "new since you last looked" markers, light or dark.
- **People and agents together.** Agents claim tasks with version-checked writes, so two never take the same one. Threads hold decisions and handoffs, notices what everyone must know. A person moves a task in one click, and every change lands in its thread.
- **A code map** (self-hosted). Each repository's files, symbols and links, built from a checkout without a model. Agents ask `board_map` instead of grepping, two open tasks on the same code warn each other, and the page draws it as nodes you open group by group.
- **Built to stay cheap.** Views are drawn by code, never by a model. Agents read only the slice they need and write in one batch, so a claim is one call of under a hundred tokens.

A board lives in one of two places. Both use the same page, documents and rules; the skill sets up either.

| | claude.ai artifact | Self-hosted site |
| --- | --- | --- |
| Agents | Claude Code signed in with claude.ai | Claude Code, Codex, any MCP client |
| Data | The artifact's database | SQLite (one file) or Supabase |
| Runs on | claude.ai, nothing to run | This computer, your domain (Docker), or Vercel |
| Teammates join by | The artifact's Share menu | A token an admin issues |
| Boards | One artifact per board | One site, a board per project at `/p/<project>` |

## Use it

Just ask, in any words and any language.

| You say | What happens |
| --- | --- |
| "Set up a task board for this project", "작업 보드 만들어줘" | **setup**: asks where the board lives, team size, split, language and task source; drafts tasks and the project's rules from your docs for a yes; publishes or creates the board, links your repositories and adds a short pointer to `CLAUDE.md` (and `AGENTS.md`). |
| "Add Cy to the board", "Add a QA status", "Switch the board to Japanese" | **adapt**: changes the board's config, or the page and the rules together. No republish. |
| "Move our board to our own server" | **move**: copies an artifact board's documents to a self-hosted project. |
| "Give me a board sign-in link", "보드 로그인 링크 줘" | A one-time browser sign-in link for a self-hosted board. |
| "Pick the next task", "Continue M1-4" | Daily work: `board_start` brings the board rules, the project's rules and your work; then claim, thread, summary, review, done. |

Share an artifact board from its **Share** menu with edit access; teammates' agents find it through the repository pointer. The first time a teammate picks their name under "I am", the board links it to their claude.ai account.

## Self-host

A site serves a project list at `/`, a board per project at `/p/<project>` and an MCP server at `/mcp`. It is the same page the artifact publishes, with a small runtime standing in for claude.ai. Needs Node 22.13 or newer.

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

`init` creates the first admin and prints a token with the commands that connect Claude Code and Codex. Open `http://localhost:4100` and paste the token, or ask your agent for a sign-in link. For teammates on your network, serve with `--host 0.0.0.0` and set `BOARD_URL` to the address they use.

**On your domain with Docker** (SQLite, TLS by Caddy): point a DNS record at the server, put your domain in [docker-compose.yml](docker-compose.yml), then:

```bash
docker compose up -d
```

```bash
docker compose exec board node server/cli.js init --person ana --name Ana
```

**On Vercel with Supabase:** create a Supabase project, then push the schema:

```bash
supabase link --project-ref <ref> && supabase db push
```

Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` and `BOARD_URL` on the Vercel project, add your domain, `vercel link`, then `npm run deploy:vercel` (`VERCEL_REGION=icn1` keeps the functions near a Seoul database). In Supabase Auth, add `<BOARD_URL>/` to the redirect URLs. To upgrade a site, pull, `supabase db push` when there are new migrations, then deploy again.

**Connect agents.** Each person gets a token (an admin issues it in **Members** on the projects page, or with `member add`) and runs one of:

```bash
claude mcp add --scope user --transport http artiboard https://board.example.com/mcp --header "Authorization: Bearer abt_…"
```

```bash
codex mcp add artiboard --url https://board.example.com/mcp --bearer-token-env-var ARTIBOARD_TOKEN
```

For Codex, keep `export ARTIBOARD_TOKEN=abt_…` in your shell profile. Codex asks before every call of a tool that can overwrite documents; to let `board_batch` run without asking, add to `~/.codex/config.toml`:

```toml
[mcp_servers.artiboard.tools.board_batch]
approval_mode = "approve"
```

**Code map.** From a repository's checkout, build and upload its map; add `--workflow` to write a CI job for the default branch (with an `ARTIBOARD_TOKEN` repository secret), or `--hook` for git hooks in a checkout only you commit to, one per repository ([Keeping the map current](skills/artiboard/references/hosted.md#keeping-the-map-current)):

```bash
node "$HOME/.claude/skills/artiboard/scripts/codemap.mjs" --site https://board.example.com --project acme --repo acme/api
```

**Customize.** Title, language and any UI string live in `meta/config` and change live. The page is per project: `artiboard page set --project acme --file page.html` for statuses, fields or views, `page reset` for the bundled page, which updates with the site.

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

Run `node server/cli.js` with no command for every option. Admins do the same from the projects page (**Members**: add, token, sign-in link, access, revoke, remove), and everyone sets their own name and role in **Profile**. Access levels are `admin`, `member` (writes) and `viewer` (reads), and a site is one team: every member sees every project. Nobody gets a password: a token signs in an agent, and the page trades a token or a one-time link for a browser session.

</details>

<details>
<summary><b>MCP tools</b></summary>

| Tool | Does |
| --- | --- |
| `board_start {project or repo}` | The board rules and the project's rules, new notices since your cursor, your open tasks, ready tasks, others' tasks waiting for review. With `repo` (a git remote) it finds the project |
| `board_claim {id, text, override?}` | Claims a ready task, posts the claim, returns spec, acceptance, summary and the code the task names |
| `board_task {id}` | Status, details, and the messages after the summary |
| `board_post {task \| tasks, text?, status?, branch?, pr?, start?, due?, repo?, summary?, touches?, override?}` | A thread message plus changes to your task. `done` unblocks dependents, `todo` releases the task; without `task`, a notice; `tasks` moves several in one write. `touches` records the files you touch, so overlapping tasks warn each other |
| `board_map {explain, file, path, query, impact, inside}` | The code map: explain a name, a file, a path between two, words, what depends on X, what X uses. No question: overview |
| `board_get`, `board_query`, `board_batch` | Documents, as `ArtifactData` reads and writes them |
| `board_page` | The project's page: size, `find`, `read`, and for admins `edits`, `html`, `reset` |
| `board_projects`, `board_create_project`, `board_whoami`, `board_login_link` | The site and its projects |

The everyday tools answer in short lines and check versions on the server, so a claim or an update is one call of under a hundred tokens.

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

| Rule | Effect |
| --- | --- |
| Code draws the board | Views, counts, readiness and "new" markers cost zero model tokens, at any team size. |
| Rules arrive with board work | Every session pays for a three-line pointer. The board rules and the project's short rules arrive only when board work starts. |
| Query, never list | Finding work is one query (`status == todo`, `waitingOn == []`); notices come as a delta after your cursor. |
| Small documents, short summaries | Task documents hold status; long text is opened for one task at a time; a handoff rewrites a five-line summary. |
| One batch per action | A claim is one call: task, message and cursor together, version-checked. |
| Self-repairing data | `waitingOn` is kept right by the page and by `board_start`, so agents never spend calls on bookkeeping. |

<details>
<summary><b>Documents</b></summary>

| Piece | What it holds | Who reads it |
| --- | --- | --- |
| `tasks/<id>` | Status only: owner, deps, `waitingOn`, claim, branch, PR, touches | The page; agents through queries |
| `details/<id>` | Spec pointer, acceptance, a five-line summary | Agents, only for the task in hand |
| `tasks/<id>/messages` | The thread: updates, questions, handoffs, blockers | Agents read the last eight; people read all |
| `notices` | What everyone must know | Agents read only what is newer than their cursor |
| `cursors/<person>` | When that person's agents last read notices | Agents |
| `meta/config` | Title, people, language, repositories, any UI string | The page |
| `meta/rules`, `meta/notes` | The project's own rules; shared status | People on the page; agents when board work starts, or when needed |
| `map/<repo>` | A repository's code map: index and chunks | Agents through `board_map`; the page's Code map section |
| `docs/artiboard.md` (repo, artifact boards) | The board rules, copied verbatim (a site gives them in `board_start`) | Agents, only in sessions that touch the board |

</details>

<details>
<summary><b><code>meta/config</code> keys</b></summary>

| Key | Example | Meaning |
| --- | --- | --- |
| `title` | `"Acme Board"` | Heading on the page |
| `subtitle` | `"What this board is for."` | One line under the heading |
| `milestone` | `"M1"` | Current milestone label |
| `lang` | `"en"`, `"ko"` | Built-in UI language. Others fall back to English. |
| `people` | `[{"id":"ana","name":"Ana","role":"backend"}]` | Order sets colors. An optional `uid` pins a person to one claude.ai account. |
| `statuses` | `["qa"]` | Extra statuses, placed before `done` |
| `strings` | `{"v_graph":"Dependencies"}` | Override any UI string, in any language |
| `footer` | `"..."` | Replaces the footer line |
| `repos` | `[{"repo":"acme/api","label":"api"}]` | The project's GitHub repositories. Agents find the board from their git remote; each task can name its own in `repo`. |

</details>

<details>
<summary><b>Repository layout and development</b></summary>

```text
skills/artiboard/                       the skill: SKILL.md, the board page (assets/board.html), the agents' references, the code map script
server/                                 the self-hosted site: HTTP app, MCP server, SQLite and Supabase stores, CLI, code map
api/, vercel.json, supabase/            a Supabase-backed site on Vercel: functions and migrations
Dockerfile, docker-compose.yml          a SQLite site in a container, behind Caddy
examples/                               the public demo, built from the page, demo-data.json and a map of examples/pantry
tests/                                  server tests (SQLite, and Supabase in CI), code map tests, the page in jsdom
FOR_AGENTS.md, AGENTS.md                install steps for agents; how to work on this repository
```

```bash
npm install && npm install --no-save jsdom@24.1.1 prettier@3.9.10 && npm run check
```

`npm run check` runs every gate: tests on a throwaway SQLite file, the page in jsdom, and the copies that must stay in step. Issues and PRs are welcome; for a change to the skill, show how agent behavior or token use changes.

</details>

## Credits

Built while coordinating a two-person, multi-agent product team on claude.ai artifacts. artiboard is independent and not affiliated with or endorsed by Anthropic. [MIT License](LICENSE).
