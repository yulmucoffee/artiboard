# Working on artiboard

For agents and people changing this repository. Setting up a board for some other project is [FOR_AGENTS.md](FOR_AGENTS.md).

artiboard is read by agents on every session they spend on a board, so it has three jobs: stay **light** (every token and round trip an agent spends is paid again in every session), stay **exact** (one set of rules for every writer, so people and agents never disagree about a task) and stay **one page** (the board is a single HTML file a claude.ai artifact can publish).

## Where things live

| Path | Owns |
| --- | --- |
| `server/tasks.js` | The task rules: holder, status side effects, who may change what, readiness. Pure functions, no I/O. Both databases enforce who may change what on every member's write; `tests/task-cases.js` runs one table through JavaScript and SQL. |
| `server/flow.js` | The everyday agent actions (`board_start`, `board_task`, `board_claim`, `board_post`, batch writes), built on the task rules. |
| `server/mcp.js` | The tool surface agents see. Its listing is snapshotted in `tests/tools.snapshot.json`. |
| `server/core.js` | Errors, write guards, and the board rules text every agent receives. |
| `server/store/sqlite.js`, `supabase/migrations/` | Storage. Both backends pass the same tests in `tests/server.test.js`. |
| `server/public/shim.js` | The page's runtime on a self-hosted site (reads, writes, live updates). |
| `skills/artiboard/assets/board.html` | The page. It carries a copy of `server/tasks.js` between marker lines. |
| `skills/artiboard/` | The skill people install: `SKILL.md`, the agents' protocol, the hosted guide. |
| `scripts/` | Levers: `check.mjs` (every gate), `inline-rules.mjs`, `stamp-version.mjs`, `readme-shape.mjs`, `unused.mjs`, `release-check.mjs` (CI: the bump, the PR in the changelog, squash merges only), `bench.mjs`, `supabase-env.sh`. |

## How we work

1. **Shape the data first.** Decide the document and its rules before the code that uses them. A new task rule is a case in `tests/tasks.test.js` and a branch in `server/tasks.js`, not an `if` added in a caller.
2. **One place per decision.** When two files decide the same thing, keep one and derive the other: the page's rules come from `server/tasks.js`, the version from `package.json`, the demo from the page. Each copy has a `--check` in `npm run check`.
3. **Take away before adding; build for what was observed.** Remove dead code and unused strings first (`scripts/unused.mjs` fails on them), then make the smallest change that does the job. No rule, guard or state for a case nobody has seen: one odd state found on one board got one repair statement, not a normalizer on every write. An abstraction has to delete branches, duplicated rules or invalid states to stay.
4. **Check at the edges, trust inside.** Tool inputs are checked by their zod schemas, writes by the store's guards. Code between them does not re-check.
5. **Make writes safe to repeat and to race.** Writes that matter carry a version condition (`if_version`; every change from the page reads the task and passes that version), a lost race rereads and decides again, and repairs such as `waitingOn` converge however often they run. Two writers aiming at one document is the thing to design away first.
6. **Prove it on the real thing.** A test counts only if it fails on the code before the change. Run it against the old code once. A check that passes too easily is suspect: look at how it observes before trusting it. Page changes get looked at in a browser, Supabase changes run against Supabase.
7. **Fix where it went wrong.** Trace a symptom to the first wrong decision and fix that, then look for the same fault elsewhere: a claim race that returned `not_yours` was the database checking the holder before the version, fixed in both databases, not in the test. A guard is a fix only when the state it handles is legitimate. When two fixes on the same belief have failed, test the belief before a third.
8. **Explain the number.** A speed claim comes with its run count, spread and what limits it (`node scripts/bench.mjs`, `RTT_MS=40` for round trips).
9. **Turn a repeated lesson into a check.** If you are about to write the same reminder a second time, write a script or a test instead and add it to `npm run check`.
10. **Keep the reader's load low.** Fewer layers to trace, less hidden state to hold. Comments say why, never what.
11. **Don't wait on people for what can be undone.** Write, test and open the PR, then report. Ask first for what cannot be undone: deploying a site, deleting data, publishing the public demo.

## Recipes

- **Bug.** Reproduce it with a failing test where its users see it (`tests/server.test.js` for tools and stores, `tests/smoke.cjs` for the page, `tests/tasks.test.js` for rules). Fix the cause, then `npm run check`.
- **Feature.** Name the data and the rule first. Then change every surface it touches: tools (and the snapshot, on purpose), the page (rules arrive through `inline-rules.mjs`), the agents' protocol in `skills/artiboard/references/`, `SKILL.md`, and the five READMEs in the same places.
- **Refactor.** Pin the behavior with tests before moving anything, move in small steps that each pass, and keep the change only if the code got easier to read.
- **Performance.** Baseline with `scripts/bench.mjs` before, the same command after, and say what bounds the result.
- **Anything bigger than one sitting.** Commit in small steps that each pass `npm run check` on their own. Keep a local decision log (`.audit/`, outside git): one row per decision with its why and its evidence. Before merging, have another model review the branch without your notes, then fix or answer each finding.

## Done means

- `npm run check` passes: version stamped, READMEs in one shape, the page's rules copy current, the demo still building, server and page tests green. CI also runs the server tests on Supabase.
- A version bump (`npm version <x.y.z> --no-git-tag-version`) and a changelog entry, as [CONTRIBUTING.md](CONTRIBUTING.md) says. The first number stays 1.
- After merging, the follow-through the change calls for: refresh an installed copy of the skill, build the demo (`node examples/build-demo.cjs`, not kept in git) and republish it, deploy a site. Ask before the last two.

## Writing

Short declarative sentences. Say what changes for the person or agent using the board before how. Repository text is English. Never write secrets, one site's names or data, or other projects' names in commits, pull requests or files here; describe the idea in our own words.
