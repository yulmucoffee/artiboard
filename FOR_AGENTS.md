# Setting up artiboard: instructions for AI agents

You are Claude Code, Codex or a compatible agent. A user gave you this repository and asked you to set up artiboard. Follow these steps in order. Speak to the user in their language.

artiboard is one skill. It builds a shared task board, then adds a short pointer to it in the user's project. The board's page draws everything from the board's database in code, so it costs no model tokens to keep it current. The board lives either in a private claude.ai artifact (Claude only) or on a self-hosted site that any agent reaches through the `artiboard` MCP server (Claude Code, Codex).

## Rules for you

- An artifact board needs the `Artifact` and `ArtifactData` tools, which exist in Claude Code signed in with claude.ai (the desktop app or the CLI). A self-hosted board needs the `artiboard` MCP server of a running site.
- Do not invent the team, ids or tasks. The skill asks the user for them.
- Commit or push only when the user asks. Sharing the artifact with teammates is the user's action in the artifact's Share menu.
- Never put tokens or secrets in files, commits or the board. A board token goes only into the user's own agent configuration, which the user runs.

## Step 1. Check the tools

- `Artifact` and `ArtifactData` present (load them with ToolSearch `select:Artifact,ArtifactData` if they are deferred): both kinds of board are possible.
- `board_whoami` (the `artiboard` MCP server) present: the user already reaches a self-hosted site.
- Neither (for example in Codex): only a self-hosted board is possible. The skill's `references/hosted.md` explains how to connect to a site or start one on this computer.

## Step 2. Install the skill

Pick one. Ask only if the request does not already say.

| Scope | When | Command |
| --- | --- | --- |
| **Personal** | "for me", "everywhere", no specific project | copy to `~/.claude/skills/artiboard` |
| **Project** | "this repo", "for our team" | copy to `<repo>/.claude/skills/artiboard` and commit it with the user's go-ahead |
| **Codex, personal** | you are Codex | copy to `~/.codex/skills/artiboard` |
| **Codex, project** | you are Codex, "this repo" | copy to `<repo>/.agents/skills/artiboard` and commit it with the user's go-ahead |

Get the source into a stable place so upgrades are a `git pull`:

```bash
git clone --depth 1 https://github.com/yulmucoffee/artiboard.git "$HOME/.artiboard/src"
```

If it already exists:

```bash
git -C "$HOME/.artiboard/src" pull --ff-only
```

Personal install:

```bash
mkdir -p "$HOME/.claude/skills/artiboard" && cp -R "$HOME/.artiboard/src/skills/artiboard/." "$HOME/.claude/skills/artiboard/"
```

Project install (run from the repository root):

```bash
mkdir -p .claude/skills/artiboard && cp -R "$HOME/.artiboard/src/skills/artiboard/." .claude/skills/artiboard/
```

Codex, personal and project:

```bash
mkdir -p "$HOME/.codex/skills/artiboard" && cp -R "$HOME/.artiboard/src/skills/artiboard/." "$HOME/.codex/skills/artiboard/"
```

```bash
mkdir -p .agents/skills/artiboard && cp -R "$HOME/.artiboard/src/skills/artiboard/." .agents/skills/artiboard/
```

An upgraded skill does not change boards that already exist. In each project with a claude.ai artifact board, ask for "upgrade the board": it republishes the page and replaces `docs/artiboard.md` with the current board rules. A self-hosted site updates when its code does (`references/hosted.md` "Upgrade").

These copy the skill's files over the installed ones, so an upgrade works without deleting the folder first. In a Claude Code setup whose permissions deny `rm -rf`, the old commands stopped at that step. A file removed upstream stays behind; the skill has a handful of files, so this rarely matters.

On Windows PowerShell, copy the folder's contents (`\*`), not the folder. `Copy-Item -Recurse` into a folder that already exists puts the copy inside it (`artiboard\artiboard`) and leaves the old files in place, so an upgrade silently changes nothing.

Personal install:

```powershell
$dest = "$HOME\.claude\skills\artiboard"
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item -Recurse -Force "$HOME\.artiboard\src\skills\artiboard\*" $dest
```

Project install (run from the repository root):

```powershell
New-Item -ItemType Directory -Force .claude\skills\artiboard | Out-Null
Copy-Item -Recurse -Force "$HOME\.artiboard\src\skills\artiboard\*" .claude\skills\artiboard
```

The Claude Code plugin works too: `/plugin marketplace add yulmucoffee/artiboard`, then `/plugin install artiboard@artiboard`. The skill is then `/artiboard:artiboard`.

## Step 3. Check the install

Confirm that `SKILL.md`, `assets/board.html`, `references/protocol.md`, `references/project-rules.md` and `references/hosted.md` exist in the folder you copied to. An older install may still hold `references/protocol-hosted.md`; it is no longer used and can go. A new session picks the skill up. In the current session, read `SKILL.md` directly and follow it.

## Step 4. Run it

If the user wants a board now, follow `SKILL.md` from "Setup". It asks where the board lives, team size (1, 2, 3 or a number), how work is split, the board language and where tasks come from, then drafts tasks and the project's rules, publishes or creates the board, seeds it and adds a short pointer to `CLAUDE.md` (and `AGENTS.md`). On a self-hosted site it also offers a code map when the project names repositories: `node <skill directory>/scripts/codemap.mjs --site <site> --project <id> --repo owner/name` (`references/hosted.md`, "Code map").

## Step 5. Report

Tell the user, briefly: where the skill is installed, the board URL if you made one, how teammates join (the artifact's Share menu, or a token from a site admin), and that teammates' agents find the board through the pointer after pulling the repository.
