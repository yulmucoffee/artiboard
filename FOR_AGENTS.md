# Setting up artiboard: instructions for AI agents

You are Claude Code (or a compatible agent). A user gave you this repository and asked you to set up artiboard. Follow these steps in order. Speak to the user in their language.

artiboard is one skill. It builds a shared task board as a single private claude.ai artifact with its own database, then installs short agent rules into the user's project. The board's page draws everything from the database in code, so it costs no model tokens to keep it current.

## Rules for you

- The board needs the `Artifact` and `ArtifactData` tools, which exist in Claude Code signed in with claude.ai (the desktop app or the CLI). If you do not have them, stop at step 1 and tell the user.
- Do not invent the team, ids or tasks. The skill asks the user for them.
- Commit or push only when the user asks. Sharing the artifact with teammates is the user's action in the artifact's Share menu.
- Never put tokens or secrets in files, commands or the board.

## Step 1. Check the tools

Look for `Artifact` and `ArtifactData` in your tools. If they are listed only as deferred tools, load them with ToolSearch (`select:Artifact,ArtifactData`). If they are missing, tell the user that artiboard needs Claude Code signed in with claude.ai, and stop.

## Step 2. Install the skill

Pick one. Ask only if the request does not already say.

| Scope | When | Command |
| --- | --- | --- |
| **Personal** | "for me", "everywhere", no specific project | copy to `~/.claude/skills/artiboard` |
| **Project** | "this repo", "for our team" | copy to `<repo>/.claude/skills/artiboard` and commit it with the user's go-ahead |

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

These copy the skill's files over the installed ones, so an upgrade works without deleting the folder first. In a Claude Code setup whose permissions deny `rm -rf`, the old commands stopped at that step. A file removed upstream stays behind; the skill has three files, so this rarely matters.

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

Confirm that `SKILL.md`, `assets/board.html` and `references/protocol.md` exist in the folder you copied to. A new session picks the skill up. In the current session, read `SKILL.md` directly and follow it.

## Step 4. Run it

If the user wants a board now, follow `SKILL.md` from "Setup". It asks for team size (1, 2, 3 or a number), how work is split, the board language and where tasks come from, then drafts tasks, publishes the board, seeds it and installs the rules file.

## Step 5. Report

Tell the user, briefly: where the skill is installed, the board URL if you made one, that the board is private until they share it, and that teammates' agents read the rules after pulling the repository.
