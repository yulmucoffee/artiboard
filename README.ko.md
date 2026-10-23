<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img alt="artiboard: 아티팩트 하나에 모든 에이전트가 같은 판을 봅니다" src="docs/assets/banner-light.svg" width="100%">
</picture>

<br/>

[![ci](https://github.com/yulmucoffee/artiboard/actions/workflows/ci.yml/badge.svg)](https://github.com/yulmucoffee/artiboard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Claude Code](https://img.shields.io/badge/Claude_Code-skill-D97757)
![claude.ai](https://img.shields.io/badge/claude.ai-artifact_+_db-2B6BEF)
![Codex](https://img.shields.io/badge/Codex-MCP-111111)
![Self-host](https://img.shields.io/badge/self--host-SQLite_·_Supabase-3ECF8E)

[English](README.md) · **한국어** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md)

### "작업 보드 만들어줘" 한마디면, 팀 전체와 모든 에이전트가 같은 판에서 일합니다.

**페이지 하나가 보드가 됩니다. 태스크, 스레드, 공지, 선행 그래프까지.** claude.ai 아티팩트로 두어도 되고, Claude Code와 Codex를 위해 직접 호스팅해도 됩니다.<br/>
화면은 페이지 코드가 보드 DB에서 바로 그려서, 토큰 한 개 쓰지 않고도 늘 최신입니다.<br/>
에이전트는 저장소에 둔 짧은 규칙을 따릅니다. 통째로 읽지 않고 질의하고, 쓰기는 한 번에 묶고, 긴 스레드 대신 요약을 읽습니다.

[데모](#미리-보기) · [빠른 시작](#빠른-시작) · [사용법](#사용법) · [직접 호스팅](#직접-호스팅) · [동작 방식](#동작-방식) · [토큰 설계](#토큰-설계) · [에이전트용 안내](FOR_AGENTS.md)

</div>

> [!TIP]
> **설치는 Claude에게 맡기세요.** Claude Code에 이렇게 붙여 넣으면 됩니다.
>
> ```text
> https://github.com/yulmucoffee/artiboard/blob/main/FOR_AGENTS.md 를 따라서 artiboard 세팅해줘
> ```
>
> Claude가 스킬을 설치한 뒤 인원(1명, 2명, 3명 또는 원하는 수), 일을 나누는 방식, 보드 언어, 첫 태스크를 어디서 가져올지를 묻습니다.

## 미리 보기

**[라이브 데모 열기 →](https://claude.ai/artifact/5zENFyGDJbEjey68J6t1bY)** 레시피 앱을 만드는 가상의 3인 팀과 태스크 14개입니다. 실제 보드 페이지를 페이지 안의 예시 데이터로 돌리니 마음껏 눌러 보세요. 태스크 집기, 스레드에 글 남기기, 찾기, `j`/`k` 이동. 몇 초 뒤 에이전트의 업데이트 두 개가 저절로 들어옵니다. 위쪽의 English / 한국어 버튼으로 예시 데이터까지 데모 전체를 한국어로 바꿀 수 있습니다. 칸반에서는 칸을 접거나 2열로 보고, 완료된 일을 보관함으로 옮겨 볼 수 있습니다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/graph-dark.png">
  <img alt="선행 그래프 보기" src="docs/assets/screens/graph-light.png" width="100%">
</picture>

<table>
<tr>
<td width="50%" valign="top">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/doc-dark.png">
  <img alt="문서 보기" src="docs/assets/screens/doc-light.png" width="100%">
</picture>

<p align="center"><sub>문서 보기</sub></p>

</td>
<td width="50%" valign="top">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/kanban-dark.png">
  <img alt="칸반 보기" src="docs/assets/screens/kanban-light.png" width="100%">
</picture>

<p align="center"><sub>칸반</sub></p>

</td>
</tr>
</table>

## 왜 artiboard인가

두 사람이 같은 코드베이스에서 각자 Claude 세션을 여러 개 돌리면, 어려운 건 코드가 아닙니다. 누가 무엇을 잡았는지, 무엇이 막혔는지, 내가 없는 동안 무엇이 바뀌었는지 아는 일입니다. 채팅 기록은 세션 사이를 건너가지 못하고, 매번 전체 상황을 프롬프트에 붙여 넣으면 비용이 금방 불어납니다.

artiboard는 그 상황을 팀이 함께 보는 실시간 판 하나에 모으고, 에이전트에게는 그 판을 싸고 엄격하게 쓰는 방법을 줍니다.

<table>
<tr>
<td width="33%" valign="top">

### 🗂️ 판 하나, 보기 셋

위에서 아래로 읽는 문서 보기, 칸반, 남은 최장 경로를 강조하는 선행 그래프. 최근 활동에는 움직인 태스크마다 마지막 메시지가 보이고, "지금"에는 막힘·마감 지남·오늘 마감이 올라옵니다. 찾기, 열 정렬, "내 것" 필터, `j`/`k` 단축키, "마지막으로 본 뒤 바뀐 것" 표시. 밝은 테마, 어두운 테마, 자동. 칸반은 Notion처럼 창을 가득 채우고, 칸을 접거나 2열로 보며, 쌓인 완료는 한 번에 보관함으로 옮깁니다.

</td>
<td width="33%" valign="top">

### 🤝 사람과 에이전트가 함께

사람마다 색이 하나씩 있습니다. 에이전트는 버전을 확인하며 태스크를 집어서, 두 에이전트가 같은 일을 잡는 일이 없습니다. 결정, 질문, 인계는 스레드에, 모두 알아야 할 것은 공지에 남습니다. 검토 중인 태스크는 검토한 사람이 완료로 넘기고, 남이 맡은 일은 사람이 시킬 때만 에이전트가 넘겨받습니다. 사람도 클릭 한 번으로 태스크를 옮기고, 바뀐 내용은 스레드에 남습니다.

</td>
<td width="33%" valign="top">

### 🪶 오래 써도 싸게

화면은 모델이 아니라 코드가 그립니다. 에이전트는 필요한 조각만 읽고 쓰기는 한 번에 묶습니다. 프로젝트가 길어질수록 차이가 커집니다.

</td>
</tr>
</table>

## 빠른 시작

보드는 두 곳 중 한 곳에 둡니다. 어느 쪽이든 같은 페이지, 같은 문서, 같은 규칙을 쓰고, 스킬은 둘 다 설치해 줍니다.

| | claude.ai 아티팩트 | 직접 호스팅한 사이트 |
| --- | --- | --- |
| 에이전트 | claude.ai로 로그인한 Claude Code (`Artifact`, `ArtifactData`) | Claude Code, Codex, 모든 MCP 클라이언트 (`artiboard` MCP 서버) |
| 데이터 | 아티팩트 DB | SQLite(파일 하나) 또는 Supabase |
| 실행 위치 | claude.ai, 따로 띄울 것 없음 | 이 컴퓨터, 내 도메인(Docker), 또는 Vercel |
| 동료가 들어오는 방법 | 아티팩트의 Share 메뉴 | 관리자가 프로젝트 목록 화면이나 `artiboard member add`로 발급한 토큰 |
| 보드 | 보드마다 아티팩트 하나 | 사이트 하나, 프로젝트마다 `/p/<project>`에 보드 하나 |

직접 호스팅하는 보드라면 [직접 호스팅](#직접-호스팅)을 따라 사이트부터 띄우세요.

**방법 A: Claude에게 맡기기.** 위 상자의 문장을 붙여 넣으세요. Claude가 [FOR_AGENTS.md](FOR_AGENTS.md)를 따릅니다.

**방법 B: 나만, 모든 프로젝트에서**

```bash
git clone --depth 1 https://github.com/yulmucoffee/artiboard.git "$HOME/.artiboard/src"
```

```bash
mkdir -p "$HOME/.claude/skills/artiboard" && cp -R "$HOME/.artiboard/src/skills/artiboard/." "$HOME/.claude/skills/artiboard/"
```

프로젝트에서 새 세션을 열고 "이 프로젝트에 작업 보드 만들어줘"라고 말하면 됩니다.

**방법 C: 팀 저장소에** (저장소 루트에서 실행한 뒤 커밋)

```bash
mkdir -p .claude/skills/artiboard && cp -R "$HOME/.artiboard/src/skills/artiboard/." .claude/skills/artiboard/
```

**방법 D: Codex.** 같은 스킬이 Codex에서도 동작합니다. 모든 프로젝트에서 쓰려면 `~/.codex/skills/artiboard`에, 저장소 하나에서만 쓰려면 `.agents/skills/artiboard`에 복사하세요.

```bash
mkdir -p "$HOME/.codex/skills/artiboard" && cp -R "$HOME/.artiboard/src/skills/artiboard/." "$HOME/.codex/skills/artiboard/"
```

Codex에는 claude.ai 아티팩트가 없으니, 직접 호스팅한 보드에서 씁니다.

업그레이드할 때는 `git -C "$HOME/.artiboard/src" pull --ff-only`를 실행한 뒤 같은 복사 명령을 다시 실행하면 됩니다. Windows PowerShell에서는 [FOR_AGENTS.md](FOR_AGENTS.md#step-2-install-the-skill)의 명령을 쓰세요.

<details>
<summary><b>Claude Code 플러그인이 편하다면</b></summary>

```text
/plugin marketplace add yulmucoffee/artiboard
/plugin install artiboard@artiboard
```

스킬 이름은 `/artiboard:artiboard`가 됩니다.

</details>

## 사용법

어떤 말로든, 어떤 언어로든 그냥 말하면 됩니다.

| 이렇게 말하면 | 이렇게 됩니다 |
| --- | --- |
| "이 프로젝트에 작업 보드 만들어줘", "Set up a task board" | **setup**: 보드를 어디에 둘지, 인원, 나누는 방식, 언어, 태스크 출처를 묻습니다. 문서에서 태스크와 프로젝트 규칙을 뽑아 보여 주고 확인을 받습니다. 보드를 올리거나 만들고 GitHub 저장소를 연결해 데이터를 넣은 뒤, `CLAUDE.md`(Codex라면 `AGENTS.md`도)에 짧은 안내를 씁니다. |
| "보드에 Cy 추가해줘", "보드를 일본어로 바꿔줘" | **adapt**: 보드 설정만 바꿉니다. 다시 올리지 않습니다. |
| "QA 상태 추가해줘", "카드에 예상 시간 보여줘" | **adapt**: 페이지와 규칙을 함께 고칩니다. 직접 호스팅한 보드에서는 `board_page` 편집으로 고칩니다. |
| "우리 보드를 우리 서버로 옮겨줘" | **move**: 아티팩트 보드의 문서를 직접 호스팅한 프로젝트로 복사합니다. |
| "보드 로그인 링크 줘", "Give me a board sign-in link" | 직접 호스팅한 보드에 브라우저로 한 번 로그인할 수 있는 일회용 링크를 줍니다. |
| "다음 태스크 집어", "M1-4 이어서 해" | 평소 작업입니다. 에이전트는 `board_start`(아티팩트 보드는 `docs/artiboard.md`)로 시작하고, 보드 규칙과 프로젝트 규칙, 할 일을 함께 받습니다. 집기, 스레드, 요약, 검토, 완료. |

설치가 끝나면 아티팩트의 **Share** 메뉴에서 동료에게 편집 권한으로 공유하세요. 동료의 에이전트는 저장소를 받아 오면 안내를 따라 보드를 찾습니다. 페이지는 누가 보는지 압니다. 동료가 "나는"에서 처음 자기 이름을 고르면 그 claude.ai 계정에 연결하고, 다음부터는 알아서 골라 둡니다. 다른 계정에 연결된 이름으로 글을 남기려 하면 경고하고, 보기 전용 사용자에게는 집기, 남기기, 고치기 버튼을 숨깁니다.

## 직접 호스팅

직접 호스팅한 사이트는 `/`에서 프로젝트 목록을, `/p/<project>`에서 프로젝트마다 보드를, `/mcp`에서 MCP 서버를 제공합니다. 보드 페이지는 아티팩트가 올리는 것과 같은 `board.html`이고, 작은 런타임(`server/public/shim.js`)이 claude.ai 대신 일합니다. 사람을 로그인시키고, 사이트 데이터를 읽고 쓰고, 바뀐 내용을 열린 페이지에 바로 밀어 줍니다. Node 22.13 이상이 필요합니다. 프로젝트 목록 맨 위에는 판마다 지금 누가 무엇을 하고 있는지 보입니다.

**이 컴퓨터에서** (SQLite, 데이터는 `~/.artiboard/board.db`)

```bash
cd "$HOME/.artiboard/src" && npm install --omit=dev
```

```bash
node server/cli.js init --person ana --name Ana --project acme --title "Acme Board"
```

```bash
node server/cli.js serve
```

`init`은 첫 관리자를 만들고, 토큰과 함께 Claude Code와 Codex를 연결하는 명령을 출력합니다. `http://localhost:4100`을 열어 토큰을 붙여 넣거나, 에이전트에게 로그인 링크를 달라고 하세요. 같은 네트워크의 동료도 들어오게 하려면 `--host 0.0.0.0`으로 띄우고 `BOARD_URL`을 동료가 쓰는 주소로 정하세요.

**내 도메인에서 Docker로** (SQLite, TLS는 Caddy): DNS 레코드가 서버를 가리키게 하고, [docker-compose.yml](docker-compose.yml)에 도메인을 넣은 뒤 실행합니다.

```bash
docker compose up -d
```

```bash
docker compose exec board node server/cli.js init --person ana --name Ana
```

**Vercel과 Supabase로:** Supabase 프로젝트를 만든 뒤, 스키마를 올리고 사이트 환경을 설정합니다.

```bash
supabase link --project-ref <ref> && supabase db push
```

Vercel 프로젝트에 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `BOARD_URL`을 설정하고, 도메인을 추가한 뒤 `vercel link`, 그다음 `npm run deploy:vercel`을 실행합니다(`VERCEL_REGION=icn1`이면 함수가 서울 DB 가까이에서 돕니다). Supabase Auth의 리디렉션 URL에 `<BOARD_URL>/`을 추가하세요. 관리자 명령은 이 변수들을 파일에 담아 두면 어디서든 실행할 수 있습니다. 예: `node server/cli.js --env site.env member list`. 같은 서버를 어느 호스트에서든 Supabase로 돌릴 수도 있습니다. `SUPABASE_*` 변수 세 개를 설정하고 `serve`하면 됩니다. 사이트를 업데이트할 때는 코드를 받고, 새 마이그레이션이 있으면 `supabase db push`를 먼저 실행한 뒤 다시 배포합니다.

**에이전트 연결.** 사람마다 토큰을 하나씩 받고(관리자가 프로젝트 목록 화면의 **멤버**에서 발급하거나 `member add` 또는 `member token`으로) 다음을 실행합니다.

```bash
claude mcp add --scope user --transport http artiboard https://board.example.com/mcp --header "Authorization: Bearer abt_…"
```

```bash
codex mcp add artiboard --url https://board.example.com/mcp --bearer-token-env-var ARTIBOARD_TOKEN
```

Codex라면 셸 프로필에 `export ARTIBOARD_TOKEN=abt_…`를 넣어 두세요. Codex는 문서를 덮어쓸 수 있는 도구(`board_batch`, `board_page`)를 부를 때마다 먼저 묻습니다. `board_batch`를 묻지 않고 실행하게 하려면 `~/.codex/config.toml`에 다음을 넣으세요.

```toml
[mcp_servers.artiboard.tools.board_batch]
approval_mode = "approve"
```

그런 다음 에이전트에게 "이 저장소에 보드 세팅해줘"라고 하면 됩니다.

**맞춤 설정**은 claude.ai에서와 똑같습니다. 제목, 언어, 모든 화면 문구는 `meta/config`에 있고 바로 반영됩니다. 누가 보드에 있는지는 관리자가 정합니다(`member join`, `member remove`). 페이지 자체는 프로젝트마다 따로 있습니다. 관리자가 `artiboard page set --project acme --file page.html`을 실행해 바꾸고(상태, 필드, 보기), `page reset`은 함께 들어 있는 기본 페이지로 되돌립니다. 이 페이지는 사이트와 함께 업데이트됩니다. 페이지 코드는 모든 멤버에게서 실행되므로, 사이트가 `ARTIBOARD_AGENT_PAGE_EDITS=1`을 설정하지 않는 한 에이전트는 페이지를 읽기만 합니다(`board_page`의 `find`). 설정하면 관리자의 에이전트가 작고 정확한 편집으로 페이지를 바꿀 수 있습니다.

| 설정 | 기본값 | 뜻 |
| --- | --- | --- |
| `BOARD_URL` | `http://localhost:4100` | 사람과 에이전트가 쓰는 주소 |
| `PORT`, `HOST` | `4100`, `127.0.0.1` | `serve`가 요청을 받는 곳 |
| `ARTIBOARD_DB` | `~/.artiboard/board.db` | SQLite 파일 |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | | 데이터를 SQLite 대신 Supabase에 둡니다 |
| `ARTIBOARD_SITE` | `artiboard` | 화면에 보이는 사이트 이름 |
| `ARTIBOARD_LANG` | `en` | 새 보드와 사이트 화면의 언어 (`en`, `ko`) |
| `ARTIBOARD_AGENT_PAGE_EDITS` | 꺼짐 | `1`이면 관리자의 에이전트가 `board_page`로 보드 페이지를 바꿀 수 있습니다 |

<details>
<summary><b>관리자 명령</b></summary>

```text
artiboard serve [--port N] [--host H]
artiboard init --person ID [--name N] [--project ID --title T]
artiboard member add|token|link|revoke|access|join|remove|list
artiboard project add|repos|drop|list
artiboard page show|set|reset --project ID
artiboard import --project ID --file FILE [--map old=new]
```

명령 없이 `node server/cli.js`를 실행하면 모든 옵션이 나옵니다. 관리자는 사이트에서도 같은 일을 합니다. 프로젝트 목록 화면의 **멤버** 패널에서 추가·새 토큰·로그인 링크·권한·회수·삭제를 하고, 모든 사람은 **프로필**에서 표시 이름과 역할을 직접 정하며 그 값이 자기가 있는 모든 판에 보입니다. 권한은 `admin`, `member`(쓰기), `viewer`(읽기)이고, 사이트 전체에 똑같이 적용됩니다. 모든 멤버가 모든 프로젝트를 봅니다. 멤버에게는 비밀번호가 없습니다. 에이전트는 토큰으로 로그인하고, 페이지는 토큰이나 일회용 링크를 브라우저 세션으로 바꿔 줍니다. `member revoke`는 그 세션도 끝냅니다. 누가 누구인지(`meta/config.people`, `people/`)는 관리자만 바꿀 수 있고, 메시지와 공지에는 언제나 쓴 사람 본인의 이름이 붙습니다.

</details>

<details>
<summary><b>MCP 도구</b></summary>

| 도구 | 하는 일 |
| --- | --- |
| `board_start {project 또는 repo}` | 보드 규칙과 프로젝트 규칙, 커서 이후의 새 공지(커서도 옮김), 내가 맡은 열린 태스크(다른 사람이 마지막으로 쓴 곳은 표시, 검토 중인 것은 한 줄로), 준비된 태스크, 검토를 기다리는 남의 태스크. `repo`(git remote)를 주면 프로젝트를 찾고 그 저장소의 일을 보여 줍니다 |
| `board_claim {id, text, override?}` | 준비된 태스크를 집고, 집었다는 글을 남기고, 스펙, 인수 조건, 요약을 돌려줍니다. `override`는 사람이 시킬 때 남이 맡은 태스크를 넘겨받습니다 |
| `board_task {id}` | 상태, 세부 내용, 요약 이후의 메시지 |
| `board_post {task \| tasks, text?, status?, branch?, pr?, start?, due?, repo?, summary?, override?}` | 스레드 메시지와 내 태스크 변경을 함께 씁니다. 마감일(`due`)은 누구나 옮길 수 있습니다. `done`이면 `doneAt`을 찍고 뒤따르는 태스크가 풀리고, `todo`면 태스크를 놓아 누구나 집을 수 있게 합니다. `task`가 없으면 공지. `tasks`는 여러 태스크에 같은 상태와 메시지를 한 번에 쓰고, 전부 되거나 하나도 안 됩니다(배포 뒤 검토 대기를 한꺼번에 완료할 때). 검토 중인 태스크는 검토한 사람도 `done`이나 `doing`으로 바꿀 수 있고, `override`는 사람이 시킬 때 남의 태스크를 바꾸며 스레드에 원래 담당을 남깁니다 |
| `board_get`, `board_query`, `board_batch` | 문서를 `ArtifactData`와 같은 방식으로 읽고 씁니다. 태스크에 쓰는 batch도 `board_post`와 같은 담당자 규칙을 따릅니다 |
| `board_page` | 프로젝트 페이지: 크기, `find`, `read`, 관리자는 `edits`, `html`, `reset`까지 |
| `board_projects`, `board_create_project`, `board_whoami`, `board_login_link` | 사이트. 프로젝트마다 GitHub 저장소가 함께 나옵니다 |

평소 쓰는 도구는 짧은 줄로 답하고 버전 확인과 시각 기록을 서버에서 하므로, 집기나 업데이트 한 번이 100토큰이 안 되는 호출 하나로 끝납니다.

</details>

## 동작 방식

```mermaid
flowchart LR
  subgraph Artifact["claude.ai 아티팩트"]
    Page["보드 페이지<br/>(코드가 그리는 화면)"]
    DB[("아티팩트 DB<br/>tasks · details · messages<br/>notices · cursors · meta")]
    Page <-- 실시간 --> DB
  end
  People(["사람"]) --> Page
  AgentA(["에이전트 세션"]) -- ArtifactData<br/>질의 + batch --> DB
  Repo["저장소<br/>CLAUDE.md 안내<br/>docs/artiboard.md 규칙"] -. 보드 일을 할 때만 .-> AgentA
```

| 구성 | 담는 것 | 누가 읽나 |
| --- | --- | --- |
| `tasks/<id>` | 상태만: 담당, 선행, `waitingOn`, 집은 쪽, 브랜치, PR, `archivedAt` | 페이지, 에이전트는 질의로 |
| `details/<id>` | 스펙 위치, 인수 조건, 다섯 줄 요약 | 에이전트, 지금 하는 태스크만 |
| `tasks/<id>/messages` | 스레드: 진행, 질문, 인계, 막힘 | 에이전트는 최근 8개, 사람은 전부 |
| `notices` | 모두 알아야 할 것 | 에이전트는 커서 이후 것만 |
| `cursors/<사람>` | 그 사람의 에이전트가 공지를 마지막으로 읽은 시각 | 에이전트 |
| `meta/config` | 제목, 사람, 언어, GitHub 저장소, 화면 문구 | 페이지 |
| `meta/rules` | 이 프로젝트만의 규칙: 누가 무엇을, 스펙 위치, 브랜치, 공지할 것 | 페이지의 사람, 보드 일을 시작할 때의 에이전트 |
| `meta/notes` | 함께 보는 현황: 일정, 지금 어디에 무엇이, 정할 것 | 페이지의 사람, 필요할 때만 에이전트 |
| `people/<person>` | 그 사람을 처음 고른 claude.ai 계정 | 페이지 |
| `docs/artiboard.md` (저장소, 아티팩트 보드) | 보드 규칙을 그대로 복사한 것(직접 호스팅하는 사이트는 `board_start`로 줍니다) | 에이전트, 보드를 쓰는 세션에서만 |

## 토큰 설계

| 규칙 | 효과 |
| --- | --- |
| 화면은 코드가 그린다 | 보기, 그래프, 개수, 준비 여부, "새 소식" 표시에 모델 토큰이 들지 않습니다. 인원이 늘어도 같습니다. |
| 규칙은 보드 일과 함께 | 모든 세션은 세 줄짜리 안내만 냅니다. 모든 보드에 같은 보드 규칙과 짧은 프로젝트 규칙은 보드 일을 시작할 때만 오고, 현황 메모는 필요할 때만 읽습니다. 보드 규칙은 artiboard에 들어 있어서 어느 프로젝트도 사본을 두거나 고치지 않습니다. |
| 통째로 읽지 않고 질의한다 | 집을 일 찾기는 질의 한 번(`status == todo`, `waitingOn == []`)입니다. 공지는 커서 이후 것만 옵니다. |
| 문서는 작게 | 태스크 문서에는 상태만 둡니다. 긴 글은 태스크 하나를 할 때만 엽니다. |
| 스레드보다 요약 | 인계할 때 다섯 줄 요약을 고쳐 쓰니, 다음 사람은 지난 메시지를 건너뜁니다. |
| 한 번의 일은 batch 하나로 | 집기는 호출 한 번입니다. 태스크, 메시지, 커서를 버전 확인과 함께. |
| 스스로 고치는 데이터 | 누군가 보드를 열어 두면 페이지가 `waitingOn`을 맞추고, `board_start`도 선행 태스크 자체를 확인해 집을 수 있는지 판단하며 어긋난 값을 지나는 길에 고칩니다. 에이전트가 장부 정리에 호출을 쓸 일이 없습니다. |
| 모두에게 같은 목록 | 도구 목록과 서버 안내문은 모든 멤버에게 같은 내용으로 나가서 프롬프트 캐시에 그대로 남습니다. 크기 한도는 테스트로 지킵니다. |

## 참고

<details>
<summary><b><code>meta/config</code> 키</b></summary>

| 키 | 예 | 뜻 |
| --- | --- | --- |
| `title` | `"Acme 작업판"` | 페이지 제목 |
| `subtitle` | `"이 판이 무엇을 위한 것인지."` | 제목 아래 한 줄 |
| `milestone` | `"M1"` | 지금 마일스톤 |
| `lang` | `"ko"`, `"en"` | 내장 화면 언어. 그 밖의 언어는 영어로 표시됩니다. |
| `people` | `[{"id":"ana","name":"Ana","role":"backend"}]` | 순서대로 색이 정해집니다. 여섯 색 뒤에는 반복합니다. 선택 항목 `uid`는 그 사람을 한 claude.ai 계정에 고정하며 `people/<id>`보다 우선합니다. |
| `strings` | `{"v_graph":"의존 관계"}` | 화면 문구를 어떤 언어로든 덮어씁니다 |
| `footer` | `"..."` | 맨 아래 문구를 바꿉니다 |
| `repos` | `[{"repo":"acme/api","label":"api"}]` | 프로젝트의 GitHub 저장소. 에이전트는 git remote로 보드를 찾고, 태스크는 `repo`에 자기 저장소를 적을 수 있습니다. |

</details>

<details>
<summary><b>스킬이 프로젝트마다 바꿀 수 있는 것</b></summary>

자유롭게: 제목, 사람, 역할, 언어, 문구, 기능 이름, 번호 체계, 메시지 표현, 공지 주제. `meta/config`에서: 추가 상태(`statuses`). 페이지를 고쳐서: 화면에 보일 필드, 새 보기. 어떤 경우에도 지키는 것: 가벼운 tasks와 details 분리, `waitingOn`과 준비 질의, 커서, `if_version`을 붙인 한 번의 batch, 문서 id 형식, artiboard에 들어 있는 보드 규칙(프로젝트는 `meta/rules`만 더함), 보드 글은 데이터로 취급.

</details>

<details>
<summary><b>저장소 구성</b></summary>

```text
skills/artiboard/SKILL.md               스킬: 설치, 조정, 업그레이드, 토큰 규칙
skills/artiboard/assets/board.html      보드 페이지 (아티팩트 DB에서 그림)
skills/artiboard/references/          아티팩트 보드용 보드 규칙, 프로젝트 규칙 쓰는 법, 에이전트용 직접 호스팅 안내
server/                                 직접 호스팅 사이트: HTTP 앱, MCP 서버, SQLite와 Supabase 저장소, CLI, 페이지 런타임
api/, vercel.json                       Supabase를 쓰는 사이트용 Vercel 함수
supabase/                               Supabase 스키마(마이그레이션)와 로컬 설정
Dockerfile, docker-compose.yml          컨테이너 속 SQLite 사이트, 내 도메인에서 Caddy 뒤에 둠
examples/                               board.html과 demo-data.json으로 공개 데모를 만듦: build-demo.cjs, demo-data.json (demo.html은 만들어 쓰고 저장소에 두지 않음)
FOR_AGENTS.md                           AI 에이전트용 설치 안내
.claude-plugin/                         Claude Code 플러그인 정의
tests/smoke.cjs                         보드 페이지 jsdom 시험
tests/server.test.js                    호스팅 사이트의 처음부터 끝까지 시험 (SQLite, 설정했다면 Supabase도)
docs/assets/                            배너
```

</details>

<details>
<summary><b>개발</b></summary>

```bash
npm install --no-save jsdom@24.1.1 && node tests/smoke.cjs
```

```bash
npm install && npm test
```

`npm test`는 쓰고 버리는 SQLite 파일로 호스팅 사이트를 돌립니다. 로컬 Supabase(`supabase start`)가 있으면 `AB_SUPABASE=1`과 그 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`를 더해 같은 시험을 거기서 돌릴 수 있습니다.

데모를 보거나 게시하려면 만듭니다(`examples/demo.html`, 저장소에 두지 않음).

```bash
node examples/build-demo.cjs
```

이슈와 PR을 환영합니다. 스킬을 바꿀 때는 에이전트의 행동이나 토큰 사용이 어떻게 달라지는지, 가능하면 실제 보드에서 전과 후를 보여 주세요.

</details>

## 만든 사람

claude.ai 아티팩트로 2인, 다중 에이전트 제품 팀을 운영하면서 만들었습니다. artiboard는 독립 프로젝트이며 Anthropic과 제휴하거나 보증받지 않았습니다. [MIT License](LICENSE).
