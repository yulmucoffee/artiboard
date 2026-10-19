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

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · **简体中文** · [Español](README.es.md)

### 说一句"建一个任务看板"，整个团队和每个 Claude agent 就在同一块看板上工作。

**一个 claude.ai artifact 就是看板：任务、讨论串、公告，还有依赖图。**<br/>
页面代码直接从 artifact 的数据库绘制一切，所以无需花费任何 token 就始终是最新的。<br/>
Agent 遵循放在你仓库里的几条精简规则：用查询代替全量读取，每个动作一次批量写入，用摘要代替冗长的讨论串。

[演示](#演示) · [快速开始](#快速开始) · [使用](#使用) · [工作原理](#工作原理) · [Token 设计](#token-设计) · [给 agent 的说明](FOR_AGENTS.md)

</div>

> [!TIP]
> **让 Claude 帮你安装。** 把下面这句粘贴到 Claude Code：
>
> ```text
> 按照 https://github.com/yulmucoffee/artiboard/blob/main/FOR_AGENTS.md 帮我安装 artiboard
> ```
>
> Claude 会先安装这个 skill，然后询问人数（1 人、2 人、3 人或任意人数）、分工方式、看板语言，以及第一批任务从哪里来。

## 演示

**[打开在线演示 →](https://claude.ai/artifact/5zENFyGDJbEjey68J6t1bY)** 一个正在开发菜谱应用的虚构三人团队，共 14 个任务。它用页面内的示例数据运行真实的看板页面，随便点：认领任务、在讨论串里留言、搜索、按 `j`/`k` 移动。几秒后会自动收到两条 agent 更新。顶部的 English / 한국어 按钮可以把整个演示（包括示例数据）切换成韩语。

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

## 为什么是 artiboard

当两个人在同一个代码库里各自运行好几个 Claude 会话时，难的不是代码，而是知道谁拿了什么、什么被卡住了、自己不在时发生了什么变化。聊天记录无法跨会话传递，而每次把全部状态贴进提示词，成本很快就会失控。

artiboard 把这些状态集中到团队共享的一块实时看板上，并给 agent 一套便宜而严格的使用方式。

<table>
<tr>
<td width="33%" valign="top">

### 🗂️ 一块看板，三种视图

从上往下读的文档视图、看板视图，以及突出最长剩余链路的依赖图。支持搜索、`j`/`k` 快捷键和"上次查看后的变化"标记。浅色与深色主题。

</td>
<td width="33%" valign="top">

### 🤝 人与 agent 协同

每个人有自己的颜色。Agent 通过带版本校验的写入认领任务，两个 agent 不会抢到同一个任务。决定、问题和交接写在讨论串里，所有人都要知道的事写在公告里。

</td>
<td width="33%" valign="top">

### 🪶 长期使用也便宜

视图由代码绘制，而不是模型。Agent 只读取需要的部分，写入一次批量完成。项目越长，差距越大。

</td>
</tr>
</table>

## 快速开始

看板使用 `Artifact` 和 `ArtifactData` 工具，因此需要用 claude.ai 登录的 Claude Code（桌面应用或 CLI）。

**方式 A：交给 Claude。** 使用上面框里的那句话。Claude 会按照 [FOR_AGENTS.md](FOR_AGENTS.md) 操作。

**方式 B：只给我自己，在所有项目中使用**

```bash
git clone --depth 1 https://github.com/yulmucoffee/artiboard.git "$HOME/.artiboard/src"
```

```bash
mkdir -p "$HOME/.claude/skills/artiboard" && cp -R "$HOME/.artiboard/src/skills/artiboard/." "$HOME/.claude/skills/artiboard/"
```

在项目中打开新会话，说"为这个项目建一个任务看板"。

**方式 C：给团队仓库**（在仓库根目录运行，然后提交）

```bash
mkdir -p .claude/skills/artiboard && cp -R "$HOME/.artiboard/src/skills/artiboard/." .claude/skills/artiboard/
```

升级时，先运行 `git -C "$HOME/.artiboard/src" pull --ff-only`，再运行同样的复制命令。在 Windows PowerShell 中，请使用 [FOR_AGENTS.md](FOR_AGENTS.md#step-2-install-the-skill) 里的命令。

<details>
<summary><b>更喜欢 Claude Code 插件？</b></summary>

```text
/plugin marketplace add yulmucoffee/artiboard
/plugin install artiboard@artiboard
```

之后 skill 名称为 `/artiboard:artiboard`。

</details>

## 使用

用任何说法、任何语言直接说就行。

| 你说 | 会发生什么 |
| --- | --- |
| "为这个项目建一个任务看板" | **setup**：询问人数、分工、语言和任务来源。从文档中起草任务并请你确认。发布看板、写入数据，并写好 `docs/artiboard.md` 和 `CLAUDE.md` 里的简短指引。 |
| "把 Cy 加到看板""把看板改成英文" | **adapt**：只更新看板配置，不重新发布。 |
| "加一个 QA 状态""在卡片上显示估时" | **adapt**：同时修改页面和规则。 |
| "领下一个任务""继续 M1-4" | 日常工作。Agent 遵循仓库里的 `docs/artiboard.md`：认领、讨论、摘要、评审、完成。 |

安装完成后，从 artifact 的 **Share** 菜单以编辑权限分享给队友。队友的 agent 拉取仓库后就会读到规则。 页面知道是谁在看：队友第一次在“I am”中选自己的名字时，看板会把它关联到其 claude.ai 账号，之后自动选中。有人用关联到其他账号的名字发帖时会给出警告；只读用户看不到领取、发帖和编辑按钮。

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

| 组成 | 内容 | 谁来读 |
| --- | --- | --- |
| `tasks/<id>` | 只有状态：负责人、依赖、`waitingOn`、认领信息、分支、PR | 页面；agent 通过查询 |
| `details/<id>` | 规格位置、验收标准、五行摘要 | Agent，仅限手头的任务 |
| `tasks/<id>/messages` | 讨论串：进展、问题、交接、阻塞 | Agent 读最近 8 条，人读全部 |
| `notices` | 所有人都要知道的事 | Agent 只读游标之后的新内容 |
| `cursors/<人>` | 此人的 agent 上次读公告的时间 | Agent |
| `meta/config` | 标题、成员、语言、界面文案 | 页面 |
| `people/<person>` | 最先选择该成员的 claude.ai 账号 | 页面 |
| `docs/artiboard.md`（仓库） | Agent 规则 | 仅在使用看板的会话中由 agent 读取 |

## Token 设计

| 规则 | 效果 |
| --- | --- |
| 代码绘制看板 | 视图、图表、计数、可领取状态和"新"标记不消耗任何模型 token，团队再大也一样。 |
| 规则放在仓库里，按需加载 | 每个会话只承担三行指引。只有使用看板的会话才读规则。仓库文本经过评审、值得信任，不同于任何人都能编辑的看板文本。 |
| 用查询，不全量读取 | 找可领取的任务只需一次查询（`status == todo`、`waitingOn == []`）。公告只取游标之后的增量。 |
| 文档保持小巧 | 任务文档只存状态。长文本只在处理某个任务时才打开。 |
| 摘要优先于讨论串 | 交接时重写五行摘要，下一个人可以跳过旧消息。 |
| 每个动作一次批量写入 | 认领就是一次调用：任务、消息、游标一起写，并校验版本。 |
| 自我修复的数据 | 只要有人打开看板，页面就会纠正 `waitingOn`，agent 很少需要为记账花调用。 |

## 参考

<details>
<summary><b><code>meta/config</code> 键</b></summary>

| 键 | 示例 | 含义 |
| --- | --- | --- |
| `title` | `"Acme Board"` | 页面标题 |
| `subtitle` | `"这块看板是做什么的。"` | 标题下的一行 |
| `milestone` | `"M1"` | 当前里程碑 |
| `lang` | `"en"`、`"ko"` | 内置界面语言，其他语言显示为英文。中文可用 `strings` 覆盖。 |
| `people` | `[{"id":"ana","name":"Ana","role":"backend"}]` | 顺序决定颜色。六种颜色后循环。 可选的 `uid` 把该成员固定到一个 claude.ai 账号，优先于 `people/<id>`。 |
| `strings` | `{"v_graph":"依赖图"}` | 用任意语言覆盖任意界面文案 |
| `footer` | `"..."` | 替换页脚文字 |

</details>

<details>
<summary><b>Skill 可以按项目调整什么</b></summary>

可自由调整：标题、成员、角色、语言、文案、功能名、编号规则、消息措辞、公告主题。通过修改页面：状态、在界面显示的字段、新视图。任何情况下都保留：轻量 tasks 与 details 分离、`waitingOn` 与可领取查询、游标、带 `if_version` 的单次批量写入、文档 id 格式、规则放在仓库、看板文本视为数据。

</details>

<details>
<summary><b>仓库结构</b></summary>

```text
skills/artiboard/SKILL.md               skill：安装、调整、升级、token 规则
skills/artiboard/assets/board.html      看板页面（从 artifact 数据库绘制）
skills/artiboard/references/protocol.md 安装到你仓库的规则文件模板
examples/                               用 board.html 和 demo-data.json 生成公开演示: build-demo.cjs, demo-data.json, demo.html
FOR_AGENTS.md                           给 AI agent 的分步安装说明
.claude-plugin/                         Claude Code 插件清单
tests/smoke.cjs                         看板页面的 jsdom 冒烟测试
docs/assets/                            横幅
```

</details>

<details>
<summary><b>开发</b></summary>

```bash
npm install --no-save jsdom@24.1.1 && node tests/smoke.cjs
```

修改页面后重新生成演示：

```bash
node examples/build-demo.cjs
```

欢迎提交 issue 和 PR。修改 skill 时，请说明 agent 行为或 token 用量如何变化，最好附上在真实看板上的前后对比。

</details>

## 致谢

在用 claude.ai artifact 运作一个两人、多 agent 的产品团队时打造。artiboard 是独立项目，与 Anthropic 无关联，也未获其背书。[MIT License](LICENSE).
