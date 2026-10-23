<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img alt="artiboard: ひとつのアーティファクトで、すべてのエージェントが同じボードを見る" src="docs/assets/banner-light.svg" width="100%">
</picture>

<br/>

[![ci](https://github.com/yulmucoffee/artiboard/actions/workflows/ci.yml/badge.svg)](https://github.com/yulmucoffee/artiboard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Claude Code](https://img.shields.io/badge/Claude_Code-skill-D97757)
![claude.ai](https://img.shields.io/badge/claude.ai-artifact_+_db-2B6BEF)
![Codex](https://img.shields.io/badge/Codex-MCP-111111)
![Self-host](https://img.shields.io/badge/self--host-SQLite_·_Supabase-3ECF8E)

[English](README.md) · [한국어](README.ko.md) · **日本語** · [简体中文](README.zh-CN.md) · [Español](README.es.md)

### 「タスクボードを作って」と言うだけで、チーム全員とすべてのエージェントが同じボードで動きます。

**ページひとつがボードになります。タスク、スレッド、お知らせ、依存グラフまで。** claude.ai のアーティファクトのまま使うことも、Claude Code と Codex 向けに自分でホストすることもできます。<br/>
画面はページのコードがボードのデータベースから直接描くので、トークンを使わずに常に最新です。<br/>
エージェントはリポジトリに置いた短いルールに従います。一覧ではなくクエリで読み、書き込みは一度にまとめ、長いスレッドの代わりに要約を読みます。

[デモ](#デモ) · [クイックスタート](#クイックスタート) · [使い方](#使い方) · [セルフホスト](#セルフホスト) · [仕組み](#仕組み) · [トークン設計](#トークン設計) · [エージェント向け](FOR_AGENTS.md)

</div>

> [!TIP]
> **セットアップは Claude に任せましょう。** Claude Code にこう貼り付けてください。
>
> ```text
> https://github.com/yulmucoffee/artiboard/blob/main/FOR_AGENTS.md に従って artiboard をセットアップして
> ```
>
> Claude がスキルを入れたあと、人数(1人、2人、3人、または任意の数)、仕事の分け方、ボードの言語、最初のタスクをどこから作るかを尋ねます。

## デモ

**[ライブデモを開く →](https://claude.ai/artifact/5zENFyGDJbEjey68J6t1bY)** レシピアプリを作る架空の3人チームと14個のタスクです。本物のボードページをページ内のサンプルデータで動かしているので、自由に触ってください。タスクを取る、スレッドに書く、検索、`j`/`k` で移動。数秒後にエージェントの更新が2件、ひとりでに届きます。 上部の English / 한국어 ボタンで、サンプルデータも含めてデモ全体を韓国語に切り替えられます。 カンバンでは列を畳んだり2列で表示したり、完了したタスクをアーカイブに移したりできます。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/graph-dark.png">
  <img alt="依存グラフのビュー" src="docs/assets/screens/graph-light.png" width="100%">
</picture>

<table>
<tr>
<td width="50%" valign="top">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/doc-dark.png">
  <img alt="ドキュメントビュー" src="docs/assets/screens/doc-light.png" width="100%">
</picture>

<p align="center"><sub>ドキュメントビュー</sub></p>

</td>
<td width="50%" valign="top">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/kanban-dark.png">
  <img alt="カンバンビュー" src="docs/assets/screens/kanban-light.png" width="100%">
</picture>

<p align="center"><sub>カンバン</sub></p>

</td>
</tr>
</table>

## なぜ artiboard か

2人が同じコードベースでそれぞれ複数の Claude セッションを動かすと、難しいのはコードではありません。誰が何を取ったか、何が止まっているか、自分がいない間に何が変わったかを知ることです。チャットの履歴はセッションをまたげず、毎回すべての状況をプロンプトに貼るとコストがすぐに膨らみます。

artiboard はその状況をチームで共有するライブなボードひとつにまとめ、エージェントにはそれを安く厳密に使う方法を与えます。

<table>
<tr>
<td width="33%" valign="top">

### 🗂️ ボードひとつ、ビュー三つ

上から読むドキュメントビュー、カンバン、残りの最長経路を強調する依存グラフ。最近の動きには動いたタスクごとの最後のメッセージが並び、「今」にはブロック・期限超過・今日が期限のものが上がります。検索、列の並べ替え、「自分の」フィルタ、`j`/`k` キー、「前回から変わったもの」の印。ライト、ダーク、自動。 カンバンは Notion のように画面いっぱいに広がり、列を畳む・2列で見る・溜まった完了をまとめてアーカイブに移すことができます。

</td>
<td width="33%" valign="top">

### 🤝 人とエージェントが一緒に

一人ひとりに色があります。エージェントはバージョンを確かめてタスクを取るので、二つのエージェントが同じタスクを取ることはありません。決定、質問、引き継ぎはスレッドに、全員が知るべきことはお知らせに。 レビュー中のタスクはレビューした人が完了にでき、他人のタスクは人が指示したときだけエージェントが引き継ぎます。人もワンクリックでタスクを動かせて、変更はスレッドに残ります。

</td>
<td width="33%" valign="top">

### 🪶 長く使っても安い

画面を描くのはモデルではなくコードです。エージェントは必要な部分だけを読み、書き込みは一度にまとめます。プロジェクトが長くなるほど差が開きます。

</td>
</tr>
</table>

## クイックスタート

ボードを置く場所は二通りです。どちらも同じページ、同じドキュメント、同じルールを使い、スキルはどちらもセットアップできます。

| | claude.ai アーティファクト | セルフホストのサイト |
| --- | --- | --- |
| エージェント | claude.ai でサインインした Claude Code(`Artifact`、`ArtifactData`) | Claude Code、Codex、任意の MCP クライアント(`artiboard` MCP サーバー) |
| データ | アーティファクトのデータベース | SQLite(ファイルひとつ)または Supabase |
| 動かす場所 | claude.ai、動かすものはなし | このコンピューター、自分のドメイン(Docker)、または Vercel |
| 仲間の参加方法 | アーティファクトの Share メニュー | 管理者がプロジェクト一覧ページか `artiboard member add` で発行したトークン |
| ボード | ボードごとにアーティファクトひとつ | サイトひとつ、プロジェクトごとに `/p/<project>` のボード |

セルフホストのボードなら、まず [セルフホスト](#セルフホスト) の手順でサイトを立ち上げてください。

**方法 A: Claude に任せる。** 上のボックスの文を貼り付けてください。Claude が [FOR_AGENTS.md](FOR_AGENTS.md) に従います。

**方法 B: 自分だけ、すべてのプロジェクトで**

```bash
git clone --depth 1 https://github.com/yulmucoffee/artiboard.git "$HOME/.artiboard/src"
```

```bash
mkdir -p "$HOME/.claude/skills/artiboard" && cp -R "$HOME/.artiboard/src/skills/artiboard/." "$HOME/.claude/skills/artiboard/"
```

プロジェクトで新しいセッションを開き、「このプロジェクトにタスクボードを作って」と言ってください。

**方法 C: チームのリポジトリに**(リポジトリのルートで実行してコミット)

```bash
mkdir -p .claude/skills/artiboard && cp -R "$HOME/.artiboard/src/skills/artiboard/." .claude/skills/artiboard/
```

**方法 D: Codex。** 同じスキルが Codex でも動きます。すべてのプロジェクトで使うなら `~/.codex/skills/artiboard` に、リポジトリ単位なら `.agents/skills/artiboard` にコピーします。

```bash
mkdir -p "$HOME/.codex/skills/artiboard" && cp -R "$HOME/.artiboard/src/skills/artiboard/." "$HOME/.codex/skills/artiboard/"
```

Codex はセルフホストのボードで使います(claude.ai のアーティファクトがないため)。

アップグレードするときは `git -C "$HOME/.artiboard/src" pull --ff-only` を実行してから、同じコピーコマンドをもう一度実行します。Windows PowerShell では [FOR_AGENTS.md](FOR_AGENTS.md#step-2-install-the-skill) のコマンドを使ってください。

<details>
<summary><b>Claude Code プラグインを使う場合</b></summary>

```text
/plugin marketplace add yulmucoffee/artiboard
/plugin install artiboard@artiboard
```

スキル名は `/artiboard:artiboard` になります。

</details>

## 使い方

どんな言い方でも、どの言語でも構いません。

| こう言うと | こうなります |
| --- | --- |
| 「このプロジェクトにタスクボードを作って」 | **setup**: ボードを置く場所、人数、分け方、言語、タスクの出どころを尋ねます。ドキュメントからタスクとプロジェクトのルールを起こして確認を取り、ボードを公開または作成して GitHub リポジトリを紐づけ、データを入れ、`CLAUDE.md`(Codex なら `AGENTS.md` も)に短い案内を書きます。 |
| 「ボードに Cy を追加して」「ボードを英語にして」 | **adapt**: ボードの設定だけを変えます。再公開しません。 |
| 「QA ステータスを追加して」「カードに見積もりを出して」 | **adapt**: ページとルールを一緒に直します。セルフホストのボードでは `board_page` の編集で直します。 |
| 「ボードを自分たちのサーバーに移して」 | **move**: アーティファクトのボードのドキュメントを、セルフホストのプロジェクトにコピーします。 |
| 「ボードのサインインリンクをちょうだい」 | セルフホストのボードに、一度だけ使えるブラウザ用のサインインリンクを出します。 |
| 「次のタスクを取って」「M1-4 の続きをして」 | 普段の作業です。エージェントは `board_start`(アーティファクトのボードでは `docs/artiboard.md`)から始め、ボードのルール、プロジェクトのルール、自分の仕事を受け取ります。 |

セットアップ後、アーティファクトの **Share** メニューから仲間に編集権限で共有してください。仲間のエージェントはリポジトリを pull すると案内からボードを見つけます。 ページは誰が見ているかを知っています。仲間が「I am」で初めて自分の名前を選ぶと、その claude.ai アカウントに紐づけ、次からは自動で選びます。別のアカウントに紐づいた名前で投稿しようとすると警告し、閲覧のみのユーザーには取得・投稿・編集のボタンを出しません。

## セルフホスト

セルフホストのサイトは、`/` でプロジェクト一覧、`/p/<project>` でプロジェクトごとのボード、`/mcp` で MCP サーバーを提供します。ボードページはアーティファクトが公開するのと同じ `board.html` で、小さなランタイム(`server/public/shim.js`)が claude.ai の代わりを務めます。人をサインインさせ、サイトのデータを読み書きし、すべての変更を開いているページに届けます。Node 22.13 以降が必要です。 プロジェクト一覧の先頭には、ボードごとに今だれが何をしているかが表示されます。

**このコンピューターで**(SQLite、データは `~/.artiboard/board.db`)

```bash
cd "$HOME/.artiboard/src" && npm install --omit=dev
```

```bash
node server/cli.js init --person ana --name Ana --project acme --title "Acme Board"
```

```bash
node server/cli.js serve
```

`init` は最初の管理者を作り、トークンと、Claude Code と Codex をつなぐコマンドを表示します。`http://localhost:4100` を開いてトークンを貼り付けるか、エージェントにサインインリンクを頼んでください。同じネットワークの仲間も入れるなら、`--host 0.0.0.0` で起動し、`BOARD_URL` を仲間が使うアドレスにします。

**自分のドメインで Docker を使って**(SQLite、TLS は Caddy): DNS レコードをサーバーに向け、[docker-compose.yml](docker-compose.yml) にドメインを書いてから実行します。

```bash
docker compose up -d
```

```bash
docker compose exec board node server/cli.js init --person ana --name Ana
```

**Vercel と Supabase で:** Supabase プロジェクトを作り、スキーマを反映してサイトの環境を設定します。

```bash
supabase link --project-ref <ref> && supabase db push
```

Vercel プロジェクトに `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY`、`BOARD_URL` を設定し、ドメインを追加して `vercel link`、それから `npm run deploy:vercel` を実行します(`VERCEL_REGION=icn1` にすると関数がソウルのデータベースの近くで動きます)。Supabase Auth のリダイレクト URL に `<BOARD_URL>/` を追加してください。管理コマンドは、これらの変数をファイルに書いておけばどこからでも実行できます。例: `node server/cli.js --env site.env member list`。同じサーバーは、どのホストからでも Supabase で動かせます。`SUPABASE_*` の3つの変数を設定して `serve` するだけです。 サイトを更新するときは、コードを取り込み、新しいマイグレーションがあれば先に `supabase db push` を実行してから再デプロイします。

**エージェントをつなぐ。** 一人ずつトークンを受け取り(管理者がプロジェクト一覧ページの **メンバー** で発行するか、`member add` または `member token` で)、次を実行します。

```bash
claude mcp add --scope user --transport http artiboard https://board.example.com/mcp --header "Authorization: Bearer abt_…"
```

```bash
codex mcp add artiboard --url https://board.example.com/mcp --bearer-token-env-var ARTIBOARD_TOKEN
```

Codex では、シェルのプロファイルに `export ARTIBOARD_TOKEN=abt_…` を書いておきます。Codex はドキュメントを上書きできるツール(`board_batch`、`board_page`)を呼ぶたびに確認を求めます。`board_batch` を確認なしで動かすには、`~/.codex/config.toml` に次を追加します。

```toml
[mcp_servers.artiboard.tools.board_batch]
approval_mode = "approve"
```

あとはエージェントに「このリポジトリにボードをセットアップして」と頼んでください。

**カスタマイズ**は claude.ai とまったく同じです。タイトル、言語、あらゆる画面の文言は `meta/config` にあり、すぐに反映されます。誰がボードに入るかは管理者が決めます(`member join`、`member remove`)。ページ自体はプロジェクトごとにあります。管理者が `artiboard page set --project acme --file page.html` を実行して変え(ステータス、フィールド、ビュー)、`page reset` で同梱のページに戻せます。同梱のページはサイトと一緒に更新されます。ページのコードはすべてのメンバーのもとで動くので、サイトが `ARTIBOARD_AGENT_PAGE_EDITS=1` を設定しない限り、エージェントはページを読むだけです(`board_page` の `find`)。設定すれば、管理者のエージェントが小さく正確な編集でページを変えられます。

| 設定 | 既定値 | 意味 |
| --- | --- | --- |
| `BOARD_URL` | `http://localhost:4100` | 人とエージェントが使うアドレス |
| `PORT`, `HOST` | `4100`, `127.0.0.1` | `serve` が待ち受ける場所 |
| `ARTIBOARD_DB` | `~/.artiboard/board.db` | SQLite のファイル |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | | データを SQLite の代わりに Supabase に置く |
| `ARTIBOARD_SITE` | `artiboard` | 画面に出るサイト名 |
| `ARTIBOARD_LANG` | `en` | 新しいボードとサイトの画面の言語(`en`、`ko`) |
| `ARTIBOARD_AGENT_PAGE_EDITS` | オフ | `1` にすると、管理者のエージェントが `board_page` でボードページを変えられる |

<details>
<summary><b>管理コマンド</b></summary>

```text
artiboard serve [--port N] [--host H]
artiboard init --person ID [--name N] [--project ID --title T]
artiboard member add|token|link|revoke|access|join|remove|list
artiboard project add|repos|drop|list
artiboard page show|set|reset --project ID
artiboard import --project ID --file FILE [--map old=new]
```

コマンドなしで `node server/cli.js` を実行すると、すべてのオプションが表示されます。管理者はサイト上でも同じことができます。プロジェクト一覧ページの **メンバー** パネルで追加・新しいトークン・サインインリンク・権限・失効・削除を行い、誰もが **プロフィール** で表示名と役割を自分で決め、それが参加しているすべてのボードに表示されます。アクセスレベルは `admin`、`member`(書き込み)、`viewer`(読み取り)で、サイト全体に適用されます。どのメンバーもすべてのプロジェクトを見られます。メンバーにパスワードはありません。エージェントはトークンでサインインし、ページはトークンや一度きりのリンクをブラウザのセッションに交換します。`member revoke` はそのセッションも終わらせます。誰が誰か(`meta/config.people`、`people/`)を変えられるのは管理者だけで、メッセージとお知らせには常に書いた本人の名前が付きます。

</details>

<details>
<summary><b>MCP ツール</b></summary>

| ツール | すること |
| --- | --- |
| `board_start {project または repo}` | ボードとプロジェクトのルール、カーソル以降の新しいお知らせ(カーソルも進める)、自分の進行中のタスク、着手できるタスク。`repo`(git remote)を渡すとプロジェクトを見つけ、そのリポジトリの仕事を出します |
| `board_claim {id, text, override?}` | 着手できるタスクを取り、取ったことを投稿し、仕様、受け入れ条件、要約を返す。`override` は人が指示したときに他人のタスクを引き継ぎます |
| `board_task {id}` | ステータス、詳細、要約より後のメッセージ |
| `board_post {task, text?, status?, branch?, pr?, start?, due?, repo?, summary?, override?}` | スレッドのメッセージと自分のタスクの変更を一度に。締め切り(`due`)は誰でも動かせる。`done` で `doneAt` が記録され、後続のタスクが着手可能になる。`todo` でタスクを手放し、誰でも取れるようになる。`task` なしならお知らせ。レビュー中のタスクはレビューした人も `done` か `doing` に変えられ、`override` は人が指示したときに他人のタスクを変更し、スレッドに元の担当を残します |
| `board_get`, `board_query`, `board_batch` | `ArtifactData` と同じ形でドキュメントを読み書き。タスクへの batch 書き込みも `board_post` と同じ担当者ルールに従う |
| `board_page` | プロジェクトのページ: サイズ、`find`、`read`、管理者は `edits`、`html`、`reset` も |
| `board_projects`, `board_create_project`, `board_whoami`, `board_login_link` | サイト。各プロジェクトの GitHub リポジトリも出ます |

普段使うツールは短い行で答え、バージョン確認と時刻の記録をサーバー側で行うので、取得や更新は100トークン未満の呼び出し1回で済みます。

</details>

## 仕組み

```mermaid
flowchart LR
  subgraph Artifact["claude.ai アーティファクト"]
    Page["ボードページ<br/>(コードが描く画面)"]
    DB[("アーティファクト DB<br/>tasks · details · messages<br/>notices · cursors · meta")]
    Page <-- ライブ --> DB
  end
  People(["人"]) --> Page
  AgentA(["エージェントのセッション"]) -- ArtifactData<br/>クエリ + batch --> DB
  Repo["リポジトリ<br/>CLAUDE.md の案内<br/>docs/artiboard.md のルール"] -. ボード作業のときだけ .-> AgentA
```

| 要素 | 中身 | 誰が読むか |
| --- | --- | --- |
| `tasks/<id>` | 状態だけ: 担当、依存、`waitingOn`、取った人、ブランチ、PR, `archivedAt` | ページ、エージェントはクエリで |
| `details/<id>` | 仕様の場所、受け入れ条件、5行の要約 | エージェント、手元のタスクだけ |
| `tasks/<id>/messages` | スレッド: 進捗、質問、引き継ぎ、ブロッカー | エージェントは直近8件、人は全部 |
| `notices` | 全員が知るべきこと | エージェントはカーソル以降だけ |
| `cursors/<人>` | その人のエージェントが最後にお知らせを読んだ時刻 | エージェント |
| `meta/config` | タイトル、メンバー、言語、GitHub リポジトリ、画面の文言 | ページ |
| `meta/rules` | このプロジェクトだけのルール: 誰が何を、仕様の場所、ブランチ、お知らせすること | ページの人、ボード作業を始めるときのエージェント |
| `meta/notes` | みんなで見る現況: 日程、どこに何があるか、決めること | ページの人、必要なときだけエージェント |
| `people/<person>` | そのメンバーを最初に選んだ claude.ai アカウント | ページ |
| `docs/artiboard.md`(リポジトリ、アーティファクトのボード) | ボードのルールをそのまま写したもの(セルフホストのサイトは `board_start` で渡します) | ボードを使うセッションのエージェントだけ |

## トークン設計

| ルール | 効果 |
| --- | --- |
| 画面はコードが描く | ビュー、グラフ、件数、着手可否、「新着」印にモデルのトークンは要りません。人数が増えても同じです。 |
| ルールはボード作業と一緒に | どのセッションも3行の案内だけを負担します。どのボードでも同じボードのルールと短いプロジェクトのルールはボード作業を始めるときだけ届き、現況メモは必要なときだけ読みます。ボードのルールは artiboard に入っているので、どのプロジェクトも写しを持たず、直しません。 |
| 一覧ではなくクエリ | 着手できる仕事は1回のクエリ(`status == todo`、`waitingOn == []`)で見つかります。お知らせはカーソル以降の差分だけ。 |
| ドキュメントは小さく | タスクのドキュメントは状態だけ。長い文章はタスクひとつのときだけ開きます。 |
| スレッドより要約 | 引き継ぎで5行の要約を書き直すので、次の人は古いメッセージを飛ばせます。 |
| 1アクションに1 batch | タスクを取るのは1回の呼び出しです。タスク、メッセージ、カーソルをバージョン確認つきで。 |
| 自分で直るデータ | 誰かがボードを開いていれば、ページが `waitingOn` を正します。`board_start` も依存先のタスクそのものを見て着手できるか判断し、ずれがあればついでに直します。エージェントが帳簿合わせに呼び出しを使うことはありません。 |
| 全員に同じ一覧 | ツール一覧とサーバーの案内は全メンバーに同じ内容で届くので、プロンプトキャッシュにそのまま残ります。サイズの上限はテストで守ります。 |

## リファレンス

<details>
<summary><b><code>meta/config</code> のキー</b></summary>

| キー | 例 | 意味 |
| --- | --- | --- |
| `title` | `"Acme Board"` | ページの見出し |
| `subtitle` | `"このボードの目的。"` | 見出しの下の一行 |
| `milestone` | `"M1"` | 現在のマイルストーン |
| `lang` | `"en"`, `"ko"` | 組み込みの画面言語。ほかの言語は英語で表示されます。日本語は `strings` で上書きします。 |
| `people` | `[{"id":"ana","name":"Ana","role":"backend"}]` | 順番で色が決まります。6色のあとは繰り返し。 任意の `uid` はそのメンバーを1つの claude.ai アカウントに固定し、`people/<id>` より優先されます。 |
| `strings` | `{"v_graph":"依存グラフ"}` | 画面の文言をどの言語でも上書き |
| `footer` | `"..."` | フッターの文を置き換え |
| `repos` | `[{"repo":"acme/api","label":"api"}]` | プロジェクトの GitHub リポジトリ。エージェントは git remote からボードを見つけ、タスクは `repo` に自分のリポジトリを書けます。 |

</details>

<details>
<summary><b>プロジェクトごとにスキルが変えてよいもの</b></summary>

自由に: タイトル、メンバー、役割、言語、文言、機能名、番号体系、メッセージの言い回し、お知らせの対象。ページを直して: ステータス、画面に出すフィールド、新しいビュー。どんな場合も守るもの: 軽い tasks と details の分離、`waitingOn` と着手クエリ、カーソル、`if_version` つきの1回の batch、ドキュメント id の形式、artiboard に入っているボードのルール(プロジェクトは `meta/rules` だけを足す)、ボードの文章はデータとして扱う。

</details>

<details>
<summary><b>リポジトリ構成</b></summary>

```text
skills/artiboard/SKILL.md               スキル: セットアップ、調整、アップグレード、トークンのルール
skills/artiboard/assets/board.html      ボードページ(アーティファクト DB から描画)
skills/artiboard/references/          アーティファクトのボード用のルール、プロジェクトのルールの書き方、エージェント向けのセルフホスト手順
server/                                 セルフホストのサイト: HTTP アプリ、MCP サーバー、SQLite と Supabase のストア、CLI、ページのランタイム
api/, vercel.json                       Supabase を使うサイト向けの Vercel 関数
supabase/                               Supabase のスキーマ(マイグレーション)とローカル設定
Dockerfile, docker-compose.yml          コンテナで動く SQLite のサイト。自分のドメインで Caddy の背後に置く
examples/                               board.html と demo-data.json から公開デモを生成: build-demo.cjs, demo-data.json, demo.html
FOR_AGENTS.md                           AI エージェント向けのインストール手順
.claude-plugin/                         Claude Code プラグインの定義
tests/smoke.cjs                         ボードページの jsdom テスト
tests/server.test.js                    ホストしたサイトのエンドツーエンドテスト(SQLite、設定があれば Supabase も)
docs/assets/                            バナー
```

</details>

<details>
<summary><b>開発</b></summary>

```bash
npm install --no-save jsdom@24.1.1 && node tests/smoke.cjs
```

```bash
npm install && npm test
```

`npm test` は使い捨ての SQLite ファイルでホストしたサイトを動かします。ローカルの Supabase(`supabase start`)があれば、`AB_SUPABASE=1` とその `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY` を加えると、同じテストをそちらで実行できます。

ページを変えたらデモを作り直します。

```bash
node examples/build-demo.cjs
```

Issue と PR を歓迎します。スキルを変えるときは、エージェントの振る舞いやトークン使用がどう変わるかを、できれば実際のボードでの前後で示してください。

</details>

## クレジット

claude.ai のアーティファクトで2人とマルチエージェントの製品チームを回しながら作りました。artiboard は独立したプロジェクトで、Anthropic との提携や保証はありません。[MIT License](LICENSE).
