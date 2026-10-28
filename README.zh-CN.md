<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img alt="artiboard：一个 artifact，所有 agent 看同一块看板" src="docs/assets/banner-light.svg" width="100%">
</picture>

<br/>

[![ci](https://github.com/yulmucoffee/artiboard/actions/workflows/ci.yml/badge.svg)](https://github.com/yulmucoffee/artiboard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Claude Code](https://img.shields.io/badge/Claude_Code-skill-D97757)
![claude.ai](https://img.shields.io/badge/claude.ai-artifact_+_db-2B6BEF)
![Codex](https://img.shields.io/badge/Codex-MCP-111111)
![Self-host](https://img.shields.io/badge/self--host-SQLite_·_Supabase-3ECF8E)

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · **简体中文** · [Español](README.es.md)

### 说一句"建一个任务看板"，整个团队和每个 agent 就在同一块看板上工作。

**一个页面就是看板：任务、讨论串、公告、依赖图和代码地图。** 可以把它留作 claude.ai artifact，也可以自行托管，供 Claude Code 和 Codex 使用。<br/>
页面代码直接从看板的数据库绘制一切，所以无需花费任何 token 就始终是最新的；agent 则通过几条精简的规则读写它。

[安装](#安装) · [演示](#演示) · [你能得到什么](#你能得到什么) · [使用](#使用) · [自托管](#自托管) · [工作原理](#工作原理) · [给 agent 的说明](FOR_AGENTS.md)

</div>

## 安装

**交给 Claude。** 把下面这句粘贴到 Claude Code，它会安装 skill，然后询问人数、分工方式、看板语言，以及第一批任务从哪里来：

```text
Set up artiboard for me by following https://github.com/yulmucoffee/artiboard/blob/main/FOR_AGENTS.md
```

**或者自己复制 skill。** 运行两条命令，然后在新会话中说"为这个项目建一个任务看板"：

```bash
git clone --depth 1 https://github.com/yulmucoffee/artiboard.git "$HOME/.artiboard/src"
```

```bash
mkdir -p "$HOME/.claude/skills/artiboard" && cp -R "$HOME/.artiboard/src/skills/artiboard/." "$HOME/.claude/skills/artiboard/"
```

使用 Codex 时，改为复制到 `$HOME/.codex/skills/artiboard`；只用于一个仓库时，复制到 `.claude/skills/artiboard`（或 `.agents/skills/artiboard`）并提交。升级时，先运行 `git -C "$HOME/.artiboard/src" pull --ff-only`，再复制一次。Windows PowerShell 的命令见 [FOR_AGENTS.md](FOR_AGENTS.md#step-2-install-the-skill)。

<details>
<summary><b>更喜欢 Claude Code 插件？</b></summary>

```text
/plugin marketplace add yulmucoffee/artiboard
/plugin install artiboard@artiboard
```

之后 skill 名称为 `/artiboard:artiboard`。

</details>

## 演示

**[打开在线演示 →](https://claude.ai/artifact/5zENFyGDJbEjey68J6t1bY)** 一个正在开发菜谱应用的三人团队：用示例数据运行的真实看板页面，可以认领任务、在讨论串里留言、打开代码地图、切换到 한국어。还会自动收到两条 agent 更新。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/graph-dark.png">
  <img alt="依赖图视图" src="docs/assets/screens/graph-light.png" width="100%">
</picture>

<table>
<tr>
<td width="50%" valign="top">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/doc-dark.png">
  <img alt="文档视图" src="docs/assets/screens/doc-light.png" width="100%">
</picture>

<p align="center"><sub>文档视图</sub></p>

</td>
<td width="50%" valign="top">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/kanban-dark.png">
  <img alt="看板视图" src="docs/assets/screens/kanban-light.png" width="100%">
</picture>

<p align="center"><sub>看板</sub></p>

</td>
</tr>
</table>

## 你能得到什么

当几个人在同一个代码库里各自运行几个 agent 会话时，难的是知道谁拿了什么、什么被卡住了、自己不在时发生了什么变化。artiboard 把这些集中到一个实时的地方，agent 用起来成本也很低。

- **一块看板，三种视图。** 从上往下读的文档视图、看板视图，以及突出最长剩余链路的依赖图。"当前"会标出被阻塞、已逾期或今天到期的任务；还有搜索、"我的"筛选、`j`/`k` 快捷键、"上次查看后的变化"标记，以及浅色或深色主题。
- **人与 agent 协同。** Agent 通过带版本校验的写入认领任务，两个 agent 不会抢到同一个任务。决定和交接写在讨论串里，所有人都要知道的事写在公告里。人也能一键移动任务，每次改动都会记在讨论串里。
- **代码地图**（自托管）。每个仓库的文件、符号和它们之间的关联，直接从检出生成，不需要模型。Agent 用 `board_map` 代替 grep，两个未完成的任务碰到同一段代码时会互相提醒，页面把地图画成可以逐组打开的节点。
- **长期使用也便宜。** 视图由代码绘制，而不是模型。Agent 只读取需要的部分，写入一次批量完成，所以一次认领就是一次不到一百个 token 的调用。

看板可以放在两个地方之一。两者使用同一个页面、同样的文档和同样的规则，skill 两种都能搭建。

| | claude.ai artifact | 自托管站点 |
| --- | --- | --- |
| Agent | 用 claude.ai 登录的 Claude Code | Claude Code、Codex、任何 MCP 客户端 |
| 数据 | Artifact 的数据库 | SQLite（一个文件）或 Supabase |
| 运行在 | claude.ai，无需自己运行任何东西 | 这台电脑、你的域名（Docker）或 Vercel |
| 队友加入方式 | Artifact 的 Share 菜单 | 管理员签发的令牌 |
| 看板 | 每块看板一个 artifact | 一个站点，每个项目一块看板，位于 `/p/<project>` |

## 使用

用任何说法、任何语言直接说就行。

| 你说 | 会发生什么 |
| --- | --- |
| "为这个项目建一个任务看板"、"Set up a task board for this project" | **setup**：询问看板放在哪里、人数、分工、语言和任务来源；根据你的文档起草任务和项目规则，请你确认；发布或创建看板，关联你的仓库，并在 `CLAUDE.md`（以及 `AGENTS.md`）里写好简短指引。 |
| "把 Cy 加到看板"、"加一个 QA 状态"、"把看板改成日语" | **adapt**：修改看板配置，或同时修改页面和规则。无需重新发布。 |
| "把我们的看板搬到自己的服务器上" | **move**：把 artifact 看板的文档复制到一个自托管项目。 |
| "给我一个看板登录链接"、"Give me a board sign-in link" | 为自托管看板生成一个一次性的浏览器登录链接。 |
| "领下一个任务"、"继续 M1-4" | 日常工作：`board_start` 带来看板规则、项目规则和你的工作；然后认领、讨论、摘要、评审、完成。 |

从 artifact 看板的 **Share** 菜单以编辑权限分享给队友；队友的 agent 会按仓库里的指引找到看板。队友第一次在“I am”中选择自己的名字时，看板会把它关联到其 claude.ai 账号。

## 自托管

站点在 `/` 提供项目列表，在 `/p/<project>` 为每个项目提供一块看板，在 `/mcp` 提供 MCP 服务器。它就是 artifact 发布的那个页面，由一个小型运行时代替 claude.ai。需要 Node 22.13 或更高版本。

**在这台电脑上**（SQLite，数据在 `~/.artiboard/board.db`）：

```bash
cd "$HOME/.artiboard/src" && npm install --omit=dev
```

```bash
node server/cli.js init --person ana --name Ana --project acme --title "Acme Board"
```

```bash
node server/cli.js serve
```

`init` 会创建第一个管理员，并打印一个令牌以及连接 Claude Code 和 Codex 的命令。打开 `http://localhost:4100` 粘贴令牌，或者让你的 agent 给你一个登录链接。要让同一网络里的队友进来，用 `--host 0.0.0.0` 启动，并把 `BOARD_URL` 设为他们使用的地址。

**用 Docker 部署到你的域名**（SQLite，由 Caddy 提供 TLS）：把一条 DNS 记录指向服务器，在 [docker-compose.yml](docker-compose.yml) 里填上你的域名，然后运行：

```bash
docker compose up -d
```

```bash
docker compose exec board node server/cli.js init --person ana --name Ana
```

**用 Vercel 和 Supabase：** 创建一个 Supabase 项目，然后推送 schema：

```bash
supabase link --project-ref <ref> && supabase db push
```

在 Vercel 项目上设置 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY` 和 `BOARD_URL`，添加你的域名，执行 `vercel link`，然后执行 `npm run deploy:vercel`（`VERCEL_REGION=icn1` 让函数靠近位于首尔的数据库）。在 Supabase Auth 中把 `<BOARD_URL>/` 加入重定向 URL。更新站点时，先拉取代码，如有新的迁移就运行 `supabase db push`，再重新部署。

**连接 agent。** 每个人拿到一个令牌（管理员在项目列表页的 **成员** 面板签发，或用 `member add`），然后运行下面其中一条：

```bash
claude mcp add --scope user --transport http artiboard https://board.example.com/mcp --header "Authorization: Bearer abt_…"
```

```bash
codex mcp add artiboard --url https://board.example.com/mcp --bearer-token-env-var ARTIBOARD_TOKEN
```

使用 Codex 时，请在 shell 配置文件里保留 `export ARTIBOARD_TOKEN=abt_…`。Codex 每次调用可能覆盖文档的工具前都会先询问；要让 `board_batch` 无需询问直接运行，把下面这段加到 `~/.codex/config.toml`：

```toml
[mcp_servers.artiboard.tools.board_batch]
approval_mode = "approve"
```

**代码地图。** 在仓库的检出目录中生成并上传地图；加 `--workflow` 为默认分支写一个 CI 工作流（需要仓库机密 `ARTIBOARD_TOKEN`），或加 `--hook` 在只有你提交的检出中安装 git 钩子，每个仓库只用其中一个（[Keeping the map current](skills/artiboard/references/hosted.md#keeping-the-map-current)）：

```bash
node "$HOME/.claude/skills/artiboard/scripts/codemap.mjs" --site https://board.example.com --project acme --repo acme/api
```

**自定义。** 标题、语言和任意界面文案都在 `meta/config` 里，修改即时生效。页面按项目区分：用 `artiboard page set --project acme --file page.html` 修改状态、字段或视图，用 `page reset` 恢复为内置页面，内置页面随站点一起更新。

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| `BOARD_URL` | `http://localhost:4100` | 人和 agent 使用的地址 |
| `PORT`, `HOST` | `4100`, `127.0.0.1` | `serve` 监听的位置 |
| `ARTIBOARD_DB` | `~/.artiboard/board.db` | SQLite 文件 |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | | 改为把数据存放在 Supabase |
| `ARTIBOARD_SITE` | `artiboard` | 界面上显示的站点名称 |
| `ARTIBOARD_LANG` | `en` | 新看板和站点界面的语言（`en`、`ko`） |
| `ARTIBOARD_AGENT_PAGE_EDITS` | 关闭 | 设为 `1` 时，管理员的 agent 可以通过 `board_page` 修改看板页面 |

<details>
<summary><b>管理命令</b></summary>

```text
artiboard serve [--port N] [--host H]
artiboard init --person ID [--name N] [--project ID --title T]
artiboard member add|token|link|revoke|access|join|remove|list
artiboard project add|repos|archive|restore|drop|list
artiboard page show|set|reset --project ID
artiboard import --project ID --file FILE [--map old=new]
artiboard map build|drop --project ID --repo R
```

不带命令运行 `node server/cli.js` 可查看全部选项。管理员在项目列表页也能做同样的事（**成员**：添加、令牌、登录链接、访问级别、吊销、移除），每个人都在 **个人资料** 里设置自己的显示名和角色。管理员用看板 ⋮ 菜单里的 **Archive project**（或 `project archive`）收起完成的项目：它移入项目列表页的 **Archived**，所有内容都保留、照常可读，但会从 agent 读取的列表中消失，在管理员从同一菜单恢复之前任何人都无法写入。同一菜单里的 **Delete project**（或 `project drop`）会永久删除该项目及其看板上的一切。访问级别有 `admin`、`member`（可写）和 `viewer`（只读），一个站点就是一个团队：每个成员都能看到所有项目。没有人需要密码：令牌让 agent 登录，页面则用令牌或一次性链接换取浏览器会话。

</details>

<details>
<summary><b>MCP 工具</b></summary>

| 工具 | 作用 |
| --- | --- |
| `board_start {project 或 repo}` | 看板规则和项目规则、游标之后的新公告、你未完成的任务、可领取的任务、等待评审的他人任务。传入 `repo`（git remote）时会找到项目 |
| `board_claim {id, text, override?}` | 认领一个可领取的任务，发布认领消息，返回规格、验收标准、摘要以及任务提到的代码 |
| `board_task {id}` | 状态、详情，以及摘要之后的消息；`brief` 不含详情 |
| `board_post {task \| tasks, text?, status?, branch?, pr?, start?, due?, repo?, summary?, touches?, override?}` | 一条讨论串消息，加上对你任务的修改。`done` 会解除依赖它的任务的阻塞，`todo` 会释放任务；不带 `task` 时发布公告；`tasks` 在一次写入里移动多个任务。`touches` 记录你触及的文件，任务重叠时会互相提醒 |
| `board_map {explain, file, path, query, impact, inside}` | 代码地图：解释一个名称、一个文件、两者之间的路径、关键词、依赖 X 的内容、X 用到的内容。不带问题时：概览 |
| `board_get`, `board_query`, `board_batch` | 读写文档，方式与 `ArtifactData` 相同；任务列表只给 key、title、status 和 owner，除非用 `fields` 要更多 |
| `board_page` | 项目的页面：大小、`find`、`read`（从 `from` 行起每次 300 行），管理员还有 `edits`、`html`、`reset` |
| `board_projects`, `board_create_project`, `board_whoami`, `board_login_link` | 站点及其项目 |

日常工具用简短的几行回答，并在服务器端校验版本，所以一次认领或更新就是一次不到一百个 token 的调用。

</details>

## 工作原理

```mermaid
flowchart LR
  subgraph Artifact["claude.ai artifact"]
    Page["看板页面<br/>（代码绘制视图）"]
    DB[("Artifact 数据库<br/>tasks · details · messages<br/>notices · cursors · meta")]
    Page <-- 实时 --> DB
  end
  People(["人"]) --> Page
  AgentA(["Agent 会话"]) -- ArtifactData<br/>查询 + 批量写入 --> DB
  Repo["你的仓库<br/>CLAUDE.md 指引<br/>docs/artiboard.md 规则"] -. 仅在看板工作时读取 .-> AgentA
```

| 规则 | 效果 |
| --- | --- |
| 代码绘制看板 | 视图、计数、可领取状态和"新"标记不消耗任何模型 token，团队再大也一样。 |
| 规则随看板工作而来 | 每个会话只承担三行指引。看板规则和简短的项目规则只在开始看板工作时送达。 |
| 用查询，不全量读取 | 找工作只需一次查询（`status == todo`、`waitingOn == []`）；公告只取游标之后的增量。 |
| 小文档，短摘要 | 任务文档只存状态；长文本只在处理某个任务时才打开；交接时重写五行摘要。 |
| 每个动作一次批量写入 | 认领就是一次调用：任务、消息、游标一起写，并校验版本。 |
| 自我修复的数据 | 页面和 `board_start` 会保持 `waitingOn` 正确，agent 不必为记账花调用。 |

<details>
<summary><b>文档</b></summary>

| 组成 | 内容 | 谁来读 |
| --- | --- | --- |
| `tasks/<id>` | 只有状态：负责人、依赖、`waitingOn`、认领信息、分支、PR、touches | 页面；agent 通过查询 |
| `details/<id>` | 规格位置、验收标准、五行摘要 | Agent，仅限手头的任务 |
| `tasks/<id>/messages` | 讨论串：进展、问题、交接、阻塞 | Agent 读最近 8 条，人读全部 |
| `notices` | 所有人都要知道的事 | Agent 只读游标之后的新内容 |
| `cursors/<person>` | 此人的 agent 上次读公告的时间 | Agent |
| `meta/config` | 标题、成员、语言、仓库、任意界面文案 | 页面 |
| `meta/rules`, `meta/notes` | 项目自己的规则；共享的现状 | 页面上的人；开始看板工作时或需要时的 agent |
| `map/<repo>` | 仓库的代码地图：索引和分块 | Agent 通过 `board_map` 读取；页面的代码地图部分 |
| `docs/artiboard.md`（仓库，artifact 看板） | 原样复制的看板规则（站点通过 `board_start` 提供） | 仅在使用看板的会话中由 agent 读取 |

</details>

<details>
<summary><b><code>meta/config</code> 键</b></summary>

| 键 | 示例 | 含义 |
| --- | --- | --- |
| `title` | `"Acme Board"` | 页面标题 |
| `subtitle` | `"这块看板是做什么的。"` | 标题下的一行 |
| `milestone` | `"M1"` | 当前里程碑 |
| `lang` | `"en"`、`"ko"` | 内置界面语言，其他语言显示为英文。 |
| `people` | `[{"id":"ana","name":"Ana","role":"backend"}]` | 顺序决定颜色。可选的 `uid` 把该成员固定到一个 claude.ai 账号。 |
| `statuses` | `["qa"]` | 额外状态，放在 `done` 之前 |
| `strings` | `{"v_graph":"依赖图"}` | 用任意语言覆盖任意界面文案 |
| `footer` | `"..."` | 替换页脚文字 |
| `repos` | `[{"repo":"acme/api","label":"api"}]` | 项目的 GitHub 仓库。Agent 通过 git remote 找到看板，每个任务可以在 `repo` 中写明所属仓库。 |

</details>

<details>
<summary><b>仓库结构与开发</b></summary>

```text
skills/artiboard/                       skill：SKILL.md、看板页面（assets/board.html）、给 agent 的参考文档、代码地图脚本
server/                                 自托管站点：HTTP 应用、MCP 服务器、SQLite 与 Supabase 存储、CLI、代码地图
api/, vercel.json, supabase/            Vercel 上基于 Supabase 的站点：函数和迁移
Dockerfile, docker-compose.yml          容器中的 SQLite 站点，位于 Caddy 之后
examples/                               公开演示，由页面、demo-data.json 和 examples/pantry 的地图生成
tests/                                  服务器测试（SQLite，CI 中也测 Supabase）、代码地图测试、在 jsdom 中测试页面
FOR_AGENTS.md, AGENTS.md                给 agent 的安装步骤；如何参与开发本仓库
```

```bash
npm install && npm install --no-save jsdom@24.1.1 prettier@3.9.10 && npm run check
```

`npm run check` 会运行所有检查：用临时 SQLite 文件跑测试、在 jsdom 中测试页面，并核对必须保持同步的各个副本。欢迎提交 issue 和 PR；修改 skill 时，请说明 agent 行为或 token 用量如何变化。

</details>

## 致谢

在用 claude.ai artifact 协调一个两人、多 agent 的产品团队时打造。artiboard 是独立项目，与 Anthropic 无关联，也未获其背书。[MIT License](LICENSE)。
