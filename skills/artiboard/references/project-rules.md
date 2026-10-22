# Writing a project's rules (`meta/rules`)

`meta/rules` holds what only this project agrees on. Agents receive it every time they start board work, right under the board rules, so it must be short (aim for 15 lines or fewer) and must not repeat anything every board already does. People read it on the page as cards and edit it there.

## What goes in

Write in the board's language, as numbered sections with `- ` bullets (lines before the first number become an intro card). Keep the sections that apply:

```text
1. Who owns what
- <person>: <area or repository>. <person>: <area>.
- Touching another person's area: <ask in the thread first / hand it over>.
2. Where specs live
- <docs path or design file>; the board points at it and never copies it.
3. Branches and merges
- <branch naming>. <who merges, which branch is main>. <deploy or release rule, if any>.
4. What to announce
- <the changes everyone must hear about: schema, shared interfaces, environment, these rules>.
5. Task conventions
- <key scheme, which milestone comes first, where else a new task must be recorded>.
```

## What stays out

- **How the board works:** claiming, posting, review and done, summaries, message length, `if_version`, `board_*` tools, document shapes. That is artiboard's and comes with every board; the site refuses it in `meta/rules`.
- **Status that changes from day to day:** today's work, the week's schedule, which version runs where, open questions, measurements, decision logs. That is `meta/notes`, which people keep up to date and agents read only when they need it. A decision that still binds everyone can stay in the rules as one line.
- **Anything long:** link to a repository document instead.
- **Secrets and sign-in links.**

## Writing it

People use Edit in the page's "Project rules" section. An agent writes it only when its person asks, after showing the text: one `board_batch` (or ArtifactData `batch`) with `{"op":"set","path":"meta/rules","data":{"text":"…","rev":<previous + 1>,"by":"<person>","updatedAt":"<ISO>"}}` and a notice that the rules changed.
