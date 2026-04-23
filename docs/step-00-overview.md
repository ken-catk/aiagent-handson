# Step 0: ハンズオン全体像と進め方

> 各Stepの手順に入る前に、まずこの資料で全体像を把握してください。
> ここだけは上から順に「読む」資料です（コマンドは実行しません）。

---

## このハンズオンで作るもの

**会食ムキムキ君** — 自然言語で「沖縄で会食したい条件」を伝えると、
グルメ検索API で店舗を検索し、健康キーワード（高タンパク/低脂質/ヘルシー）で
フィルタして候補を返す **AIエージェント + MCP サーバー**。

### 最終的に動く対話例（Step 7 完了時）

```bash
docker compose run --rm agent "沖縄で会食向けに、タンパク質が取りやすいお店を教えて"
```

```
健康会食候補として、以下3件を推奨します:

1. とりいちず 与那原店（居酒屋）
   ヒット: 「鶏料理」「タンパク質」
   筋トレ観点: 高タンパク・低脂質でバルク維持に向く
   URL: <店舗詳細URL>

2. 地鶏備長とり幻（和食）
   ヒット: 「地鶏」「炙り」
   筋トレ観点: 脂質控えめな調理法

3. ...（最大5件）
```

- 検索エリア: **沖縄全体**（固定）
- LLM: **OpenAI Responses API**（`gpt-4.1-mini`）
- データソース: **グルメ検索API**

---

## 全体フロー（約2時間45分、全8ステップ）

```
[ Stage A: 土台 ]
  Step 1 (15分)  Docker + Node 24 の骨組み

[ Stage B: MCPサーバーを段階的に組む ]
  Step 2 (15分)  stdio起動 + ログ基盤
  Step 3 (25分)  グルメクライアント + search_shops ツール
  Step 4 (15分)  get_shop_detail ツール追加

[ Stage C: AIエージェントを段階的に組む ]
  Step 5 (20分)  Agent最小（LLM疎通だけ、ツール無し）
  Step 6 (30分)  Agent-MCP tool calling ループ ★ 対話体験スタート

[ Stage D: 業務ロジック ]
  Step 7 (25分)  健康判定フィルタ統合 ★ 完成形

[ Stage E: 仕上げ ]
  Step 8 (20分)  連携テスト（正常系確認）
```

各Stepは **1コミット単位**で区切られ、壊れない状態で積み上がります。
進捗・コミット計画の詳細は `dev-plan-v2.md §3` を参照。

---

## 各Stepで何ができるようになるか

| Step | 今できるようになること | 対話可能？ |
|---|---|---|
| 1 | Docker コンテナで Node 24 が動く | ✗ |
| 2 | MCPサーバーが stdio で起動、ログが観察できる | ✗ |
| 3 | MCP 経由で沖縄の店舗を検索できる（テスト経由） | ✗ |
| 4 | 2ツール（search + detail）を連鎖呼び出しできる | ✗ |
| 5 | Agent に日本語で話しかけて LLM の応答が返る | △ LLM知識のみ（根拠なし） |
| **6** | **Agent が実際に グルメ を叩いて根拠ある回答をする** | **◎ ここから本物の対話** |
| **7** | **健康フィルタ付き「会食ムキムキ君」として完成** | **◎◎ 最終形** |
| 8 | 連携テストで正常系を自動検証 | — |

**受講者が「Agentと対話している」と体感できるのは Step 6 から**。
Step 5 はあくまで LLM 疎通確認で、具体店舗は出ません（ハルシネーション）。
Step 6 以降は「自由実験」節で自分の好きな質問を試せる構成になっています。

---

## 2ターミナル運用（Step 2 から）

本ハンズオンの体験価値の核は **2 ターミナル同時観察**。

```
┌─────────────────────────┐  ┌──────────────────────────────┐
│ Terminal A (実行側)     │  │ Terminal B (観察側)          │
├─────────────────────────┤  ├──────────────────────────────┤
│ docker compose run ...  │  │ tail -F logs/mcp-*.jsonl     │
│                         │  │ tail -F logs/agent-*.jsonl   │
│ → 結果が出る            │  │ → 内部フローがJSON で流れる  │
└─────────────────────────┘  └──────────────────────────────┘
```

- **Terminal A**: 自分が入力、結果を受け取る（ユーザー目線）
- **Terminal B**: Agent / MCP の内部ログを時系列観察（開発者目線）

Step 6 以降は「**LLMがどのタイミングで MCP の何を呼んだか**」が Terminal B で
見えるようになり、ハンズオンの学習価値が最大化します。

詳細は `dev-plan-v2.md §3.3 ログ観察の段階的強化` を参照。

---

## 前提条件

### 必須

- **macOS / Linux**
- **Docker Desktop**（`docker --version` / `docker compose version` 応答OK）
- **mise**（`.mise.toml` で Node 24.15.0 自動切替）
- **`.env`** に以下キー投入済:
  - `OPENAI_API_KEY` — OpenAI API (Responses API対応)
  - `GOURMET_API_KEY` — グルメ Webサービス（`register` で取得）
  - `MCP_AUTH_TOKEN` / `AGENT_MCP_TOKEN` — ローカル認証用（自動生成済み）

### 推奨

- **jq** — `brew install jq`（ログを見やすく整形）
- ターミナルを **2タブ開ける**エディタ（iTerm2 / VSCode ターミナル / tmux など）

---

## ディレクトリ構成（完成時）

```text
aiagent-handson/
├── prd-kaishoku-mukimuki-v1.md    PRD（業務要件）
├── dev-plan-v2.md                 開発計画（最新）
├── procedure-docs/                手順書（各Step）
│   ├── step-00-overview.md        ← このファイル
│   ├── step-01-foundation.md
│   ├── step-02-mcp-minimal.md
│   ├── step-03-search-shop.md
│   ├── step-04-get-shop-detail.md
│   ├── step-05-agent-minimal.md
│   ├── step-06-tool-loop.md
│   ├── step-07-healthy-filter.md
│   └── step-08-integration-test.md
├── .env.example                   環境変数テンプレ
├── .env                           実体（gitignore）
├── .gitignore
├── docker-compose.yml             mcp / agent 2サービス
├── logs/                          JSON Lines ログ（gitignore）
├── mcp/                           MCPサーバー
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── resources/
│   │   └── gourmet-api.html
│   └── src/
│       ├── logger.ts
│       ├── server.ts
│       ├── gourmet.ts
│       ├── tools.ts
│       └── check.ts
└── aiagent/                       AIエージェント
    ├── Dockerfile
    ├── package.json
    ├── tsconfig.json
    ├── config/
    │   ├── healthy_keywords.json
    │   └── excluded_keywords.json
    └── src/
        ├── index.ts
        ├── llm.ts
        ├── mcp-client.ts
        ├── agent.ts
        ├── healthy-filter.ts
        └── logger.ts
```

---

## 進め方のコツ

### 各Stepの手順書の読み方

どのStepの手順書も以下の構造:

1. **このStepで作るもの** — ディレクトリツリー + ファイル一覧
2. **完了条件** — 動いたと判定する基準
3. **所要時間**
4. **前提条件**
5. **手順** — コマンド・ファイル内容をコピペ可能な形で
6. **動作確認** — 完了条件を満たすか確認
7. **ログ観察タブ** — Terminal B で見るもの（Step 2 以降）
8. **トラブルシュート**
9. **このStepでの勘どころ** — 学びのポイント
10. **コミット** — git add / commit コマンド
11. **やってみる ✨** — 1分でできるミニ実演

**迷ったら**: 手順通りにコピペして、動作確認が通ればOK。
理解を深めたいところだけ「勘どころ」や「トラブルシュート」を読む。

### 詰まったら

| 症状 | 対処 |
|---|---|
| `docker` コマンドが無い | Docker Desktop 起動 |
| `Cannot find module '...'` | `docker compose build <service>` 再実行 |
| APIキー関連エラー | `.env` の値を確認、`env_file` のロード確認 |
| ログが出ない | `logs/` ディレクトリ存在確認、`docker-compose.yml` の `./logs:/app/logs` マウント確認 |

各Step手順書に詳細なトラブルシュート表があります。

---

## アブレーション実験の実行方法（Step 9 / Step 10）

本編完走後、「MCPの◯◯を削ったらAgentの性能はどう変わるか」を実測する
**アブレーション実験**が2種類用意されています。

**切替方法は import 1行のコメント入れ替え**。環境変数や別コマンドは使いません:
- 変更が git diff で明白（再現性・共有性が高い）
- 元に戻すのは `git checkout -- <file>` 1発
- Biome が format-on-save で安全に整形してくれるので、VSCode と衝突しない

### 実験A: Tool Description 情報量削減（Step 9）

`mcp/src/server.ts` の冒頭、import 2行のうち**有効な方を切替**:

```typescript
// 通常モード
import { GET_SHOP_DETAIL_TOOL, SEARCH_SHOPS_TOOL } from "./tools.ts";
// import { GET_SHOP_DETAIL_TOOL, SEARCH_SHOPS_TOOL } from "./tools-ablation-desc.ts";

// アブレーション（コメントを入れ替える）
// import { GET_SHOP_DETAIL_TOOL, SEARCH_SHOPS_TOOL } from "./tools.ts";
import { GET_SHOP_DETAIL_TOOL, SEARCH_SHOPS_TOOL } from "./tools-ablation-desc.ts";
```

実行コマンドは**どちらも同じ**:

```bash
docker compose run --rm agent npm run dev -- "<プロンプト>"
```

戻し:

```bash
git checkout -- mcp/src/server.ts
```

観察点: LLM が呼ぶ `tool_call.args` の質、ターン数、filter後件数、応答の冗長さ。

### 実験B: MCP Resource 参照削減（Step 10）

`aiagent/src/agent.ts` の冒頭、import 2行のうち**有効な方を切替**:

```typescript
// 通常モード（リソース注入あり）
import { loadResourceInstructions } from "./resource-loader.ts";
// import { loadResourceInstructions } from "./resource-loader-ablation.ts";

// アブレーション（コメントを入れ替える）
// import { loadResourceInstructions } from "./resource-loader.ts";
import { loadResourceInstructions } from "./resource-loader-ablation.ts";
```

実行・戻しは同じコマンドパターン:

```bash
docker compose run --rm agent npm run dev -- "<プロンプト>"
git checkout -- aiagent/src/agent.ts
```

観察点: `budget:"安い"` のような不正引数の発生、`service_area` を勝手に指定してくるか、
MAX_TURNS 超過率、ヒット件数。

### 2つ同時にアブレーション

両方のファイルのコメントを切替してから実行するだけ:

```bash
# 実行
docker compose run --rm agent npm run dev -- "<プロンプト>"

# 両方戻す
git checkout -- mcp/src/server.ts \
                aiagent/src/agent.ts
```

### ログでの見分け方

Terminal B で `list_tools` と `resources_loaded` / `resources_skipped` phase を見れば、
**そのログがどの条件で取られたか一目瞭然**:

| phase | 通常 | アブレーションA | アブレーションB |
|---|---|---|---|
| `list_tools.desc_lengths` | 長（例 `[251, 263]`） | 短（例 `[6, 5]`） | 長 |
| `resources_loaded` or `resources_skipped` | `resources_loaded` | `resources_loaded` | `resources_skipped` |

詳細は [Step 9](./step-09-ablation-tool-description.md) / [Step 10](./step-10-ablation-mcp-resource.md) 手順書を参照。

---

## 関連資料

- **PRD（業務要件）**: [`prd-kaishoku-mukimuki-v1.md`](../prd-kaishoku-mukimuki-v1.md)
  - 判定ロジック、キーワード辞書、出力ルール、確定事項14項目
- **開発計画**: [`dev-plan-v2.md`](../dev-plan-v2.md)
  - 8ステップ詳細、コミット計画、ログ観察方針、Done条件
- **各Step手順書**: `procedure-docs/step-XX-*.md`

---

## 次のStep

→ [Step 1: 土台作成 — Docker Compose + パッケージ骨組み](./step-01-foundation.md)
