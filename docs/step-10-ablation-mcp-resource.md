# Step 10: アブレーション実験B — MCP Resource 参照削減

> **アブレーション（ablation）** = システムの一部を取り除いて性能差を測る実験手法。
> 実験A（Step 9）は Tool Description を削る方向だったが、
> ここでは **MCP Resource（グルメ検索API リファレンス）を Agent の system prompt から抜く** 方向で測定する。
>
> **切替方法**: 実験Aと同じく、import 行のコメント入れ替えだけ。
> `aiagent/src/agent.ts` の `loadResourceInstructions` の import 先を切替える。

## このStepで作るもの

### Step 10 完了時点のディレクトリ構造

```text
learn-aiagent/aiagent-and-mcp/
├── ... (Step 9 完了状態のまま)
└── aiagent/
    └── src/
        ├── agent.ts                    ← 更新（このStep、import 切替構造に）
        ├── resource-loader.ts          ← 新規（このStep、通常版。リソース読み込み）
        └── resource-loader-ablation.ts ← 新規（このStep、アブレーション版。空を返す）
```

### 作成・更新ファイル

- `aiagent/src/resource-loader.ts`: MCP の listResources + readResource を叩き、HTML をテキスト化して system prompt 用ブロックにする通常版
- `aiagent/src/resource-loader-ablation.ts`: 常に空文字列を返すアブレーション版
- `aiagent/src/agent.ts`: `loadResourceInstructions` の import 行で切替可能な形に

## 完了条件

- 通常モード: agent.ts が `./resource-loader.ts` を import → リソース注入あり
- アブレーションモード: `./resource-loader-ablation.ts` を import → 注入スキップ
- `git checkout -- agent.ts` で一発で戻せる
- ログの `resources_loaded` / `resources_skipped` で現在のモード判別可能

## 所要時間

約 20〜25 分（観察と比較含む）

## 前提条件

- Step 9 完了済み（実験Aの import 切替を理解している）
- **Step 3 で MCP Resource が公開済み**（`mcp/resources/gourmet-api.html` が配置されている）
- 2 ターミナル運用に慣れている

---

## 実験の狙い

**仮説**: MCP Resource として API リファレンスを公開し、Agent がそれを読んで
system prompt に注入すると、LLM のツール引数組み立て精度が上がる。

情報が無い場合に起こりがちなこと:

| 現象 | 例 |
|---|---|
| 予算コードの不正値 | `budget:"安い"` / `budget:"4000円"`（正解は `B001`〜`B014`） |
| エリアコードの推測 | LLM が `service_area:"SA11"` を指定（沖縄は `SA98` 固定） |
| 上限超過 | `count:50`（上限は30）|
| 不存在パラメータ | `area:"沖縄"` のような実在しないパラメータ |

参照情報が system prompt に入っていれば LLM はこれらを避けやすくなる**はず**。
実測で検証します。

---

## 手順

### 1. ディレクトリに移動

```bash
cd learn-aiagent/aiagent-and-mcp
```

### 2. `aiagent/src/resource-loader.ts` を新規作成（通常版）

```bash
cat > aiagent/src/resource-loader.ts << 'EOF'
/**
 * MCP Resource 読み込みモジュール（通常モード）
 *
 * MCP の resources/list + resources/read で全公開リソースを読み取り、
 * system prompt 用のテキストブロックに組み立てる。
 *
 * アブレーション実験B で使わない場合は、agent.ts の import を
 * `./resource-loader-ablation.ts` に切替える。
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { log } from "./logger.ts";

const MAX_PER_RESOURCE = 40_000;

/** HTMLを粗くテキスト化（script/style 除去、主要ブロック要素で改行、タグ剥がし、エンティティ復号） */
function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|tr|li|h[1-6]|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * MCP から全公開リソースを読み取り、system prompt への追加ブロックを返す。
 * リソースが無ければ空文字列。
 */
export async function loadResourceInstructions(mcp: Client): Promise<string> {
  const res = await mcp.listResources();
  if (res.resources.length === 0) {
    log("resources_empty", {});
    return "";
  }

  const sections: string[] = [];

  for (const r of res.resources) {
    const read = await mcp.readResource({ uri: r.uri });
    const first = read.contents[0] as { text?: string; mimeType?: string };
    if (!first?.text) continue;

    let body = first.text;
    if (first.mimeType === "text/html") {
      body = htmlToText(body);
    }
    if (body.length > MAX_PER_RESOURCE) {
      body = `${body.slice(0, MAX_PER_RESOURCE)}\n... (truncated)`;
    }

    sections.push(`## ${r.name} (${r.uri})\n${body}`);
  }

  const block = `【API リファレンス（MCP Resources 経由で取得）】\n${sections.join("\n\n")}`;
  log("resources_loaded", { bytes: block.length });
  return block;
}
EOF
```

**ポイント**:
- `htmlToText` は最小限の整形。完璧を目指さない（LLM はノイズ混じりでも意味を取れる）
- `MAX_PER_RESOURCE = 40KB` で context window 肥大化を防ぐ
- `log("resources_loaded", ...)` で実験条件をログに残す

### 3. `aiagent/src/resource-loader-ablation.ts` を新規作成（アブレーション版）

```bash
cat > aiagent/src/resource-loader-ablation.ts << 'EOF'
/**
 * MCP Resource 読み込みモジュール（アブレーション版）
 *
 * アブレーション実験B: MCP Resource を一切読まずに空文字列を返す。
 * これにより system prompt に API リファレンスが注入されない状態を作る。
 *
 * 使い方: agent.ts の import を `./resource-loader.ts` からこちらに切替える
 * （元に戻すには: git checkout -- aiagent/src/agent.ts）
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { log } from "./logger.ts";

/**
 * 常に空文字列を返す（アブレーション版）。
 * MCP への通信も行わない（アブレーション条件として明確にするため）。
 */
export async function loadResourceInstructions(_mcp: Client): Promise<string> {
  log("resources_skipped", { reason: "resource-loader-ablation.ts imported" });
  return "";
}
EOF
```

**ポイント**:
- 通常版と**同じシグネチャ** (`(mcp: Client) => Promise<string>`)
- 中身は空文字列を返すだけ。**MCP通信もしない**（明確にアブレーション）
- `log("resources_skipped", ...)` でログに条件を残す

### 4. `aiagent/src/agent.ts` の import 部分を「切替可能な形」に更新

`agent.ts` の冒頭 import 部分に以下を追記（既存 import 群の直後に）:

```typescript
// ─────────────────────────────────────────────────────────────────────
// アブレーション実験B: MCP Resource 参照削減
// ─────────────────────────────────────────────────────────────────────
// 通常モード: ./resource-loader.ts を import（リソースを読み、system prompt に注入）
// アブレーション: 下の行をコメントアウトし、`./resource-loader-ablation.ts` を有効化
// （元に戻すには: git checkout -- aiagent/src/agent.ts）
import { loadResourceInstructions } from "./resource-loader.ts";
// import { loadResourceInstructions } from "./resource-loader-ablation.ts";
```

`runAgent` 関数内、`log("agent_start", ...)` の直後に Resource 読み込み + 組み立て処理を入れる:

```typescript
    log("agent_start", {
      tool_names: toolsList.tools.map((t) => t.name),
    });

    // アブレーション実験B: import を resource-loader-ablation.ts に切替えるとスキップ版が走る
    const referenceBlock = await loadResourceInstructions(mcp);
    const instructions = referenceBlock ? `${SYSTEM_PROMPT}\n\n${referenceBlock}` : SYSTEM_PROMPT;
```

そして最初の `client.responses.create` の `instructions: SYSTEM_PROMPT` を新しい変数に置換:

```typescript
    let response = await client.responses.create({
      model,
      instructions,  // ← SYSTEM_PROMPT から instructions に変更
      input: userInput,
      tools: tools as any,
    });
```

**設計ポイント**:
- **2 つのファイルが同じシグネチャ**で export しているので、import 先を切替えるだけで挙動が変わる
- agent.ts 本体に if 文も env 判定も入らない。**読みやすい**
- `git checkout -- agent.ts` で安全に戻せる

### 5. `aiagent/src/logger.ts` に新 phase の desc を追加

既存の `PHASE_DESC` マップに3件追加:

```typescript
  agent_start: "Agent起動・ツール取得完了",
  resources_loaded: "MCP Resource を system prompt に注入",
  resources_skipped: "MCP Resource 読み込みをスキップ（アブレーション）",
  resources_empty: "MCP Resource が公開されていない",
  llm_request: "OpenAIへ推論リクエスト送信",
```

### 6. 再ビルド不要

volume マウントでソースは即反映。新 npm 依存なし。

---

## 動作確認

### 通常モード（初期状態）

```bash
docker compose run --rm agent npm run dev -- "沖縄で予算4000円で鶏料理の会食候補を3つ"
```

特徴的なログ:

```
{"source":"agent","phase":"resources_loaded","desc":"MCP Resource を system prompt に注入","bytes":21390}
```

→ 約 21KB のテキストが system prompt に注入されている。

### アブレーションモードに切替

`aiagent/src/agent.ts` の冒頭2行のコメントを入れ替え:

**Before**（通常）:
```typescript
import { loadResourceInstructions } from "./resource-loader.ts";
// import { loadResourceInstructions } from "./resource-loader-ablation.ts";
```

**After**（アブレーション）:
```typescript
// import { loadResourceInstructions } from "./resource-loader.ts";
import { loadResourceInstructions } from "./resource-loader-ablation.ts";
```

### アブレーション実行

```bash
docker compose run --rm agent npm run dev -- "沖縄で予算4000円で鶏料理の会食候補を3つ"
```

特徴的なログ:

```
{"source":"agent","phase":"resources_skipped","desc":"MCP Resource 読み込みをスキップ（アブレーション）","reason":"resource-loader-ablation.ts imported"}
```

### 元に戻す

```bash
git checkout -- aiagent/src/agent.ts
```

両モードで Agent が正常に最終応答を返せば **Step 10 セットアップ完了**。

---

## ログ観察タブ（Terminal B）

```bash
tail -F logs/*.jsonl 2>/dev/null | jq -c 'select(.phase=="resources_loaded" or .phase=="resources_skipped" or .phase=="tool_call" or .phase=="agent_done" or .phase=="filter_applied")'
```

### 注目する phase

- `resources_loaded.bytes` — 注入サイズ（通常数万bytes）
- `resources_skipped` — アブレーション時に出る
- `tool_call.args` — LLM がどう引数を組むか変化するか
- `agent_done.turns` — リトライ回数
- `filter_applied.output_count` — 最終候補数

---

## 観察記録シート

同じプロンプトで**通常 vs アブレーション**を比較:

### プロンプト（意図的に曖昧な予算指定）

```
<ここに使ったプロンプトを書く。推奨: 「沖縄で予算4000円で鶏料理の会食候補を3つ」>
```

※ 「予算4000円」は グルメ の `B003` 相当（3001〜4000円）。LLM が API リファレンスを参照していれば `budget:"B003"` を指定する可能性が上がるが、無ければ `"4000円"` や `"B004"` のような誤値になりがち。

### 結果比較

| 観点 | 通常版（Resource 注入あり） | アブレーション版（`resource-loader-ablation.ts`） | 差分メモ |
|---|---|---|---|
| `tool_call.args.budget` の値 | | | |
| `tool_call.args.keyword` の値 | | | |
| LLM が他の存在しないパラメータを渡した？ | | | |
| ターン数（agent_done.turns） | | | |
| `filter_applied` の input_count / output_count | | | |
| 最終応答の content_length | | | |
| 応答内の情報正確性（主観） | | | |

### 気づき欄

- 通常版で参照情報が効いていた具体例:
- アブレーション版で起きた失敗モード:
- コンテキスト増加（21KB）に見合う品質向上があったか:

### 複数回実行推奨

各モード 3 回ずつで傾向を見る（temperature=0 でも微妙にブレる）。

---

## 戻し方

```bash
git checkout -- aiagent/src/agent.ts
```

`resource-loader-ablation.ts` はリポジトリに残しておく（次回実験に再利用）。

---

## トラブルシュート

| 症状 | 原因候補 | 対処 |
|---|---|---|
| `ENOENT: no such file or directory '/app/resources/gourmet-api.html'` | MCP server の PATH 解決ミス | server.ts が `fileURLToPath(import.meta.url)` 基点で解決していれば解消。Step 3 の正しい実装を確認 |
| `resources_empty` が出る | MCP 側の ListResources ハンドラが未登録 or 空配列 | Step 3 の server.ts 実装を確認 |
| import 切替えたのに resources_loaded/skipped が変わらない | 両方の行を同時に有効化/無効化した | agent.ts を開いて**有効な import は1行だけ**確認 |
| 通常モードで context window エラー | 21KB 程度なら問題ないが、巨大リソース追加時に発生 | `MAX_PER_RESOURCE` を小さくする、または関連セクション抽出パース |

---

## このStepでの勘どころ

1. **実験Aと実験Bは「情報量の方向」が逆**
   - A: 情報を**減らす**（tool description を簡素化）
   - B: 情報を**足す**（MCP Resource を system prompt に注入）
   - どちらも「情報の価値」を定量化する実験

2. **MCP Resource の活用パターン**
   - サーバー側で `ListResources` / `ReadResource` を公開（Step 3 で実装済）
   - クライアント側で `listResources()` + `readResource()` で読み取り
   - クライアントが LLM プロンプトに組み込む（ここが使い方の肝）
   - **MCPプロトコル自身はLLMにリソースを渡す方法を規定しない**。ホスト/クライアント実装の裁量

3. **「同じシグネチャの2モジュール」パターン**
   - 実験Aの tools 切替と同じ構造
   - `resource-loader.ts` と `resource-loader-ablation.ts` が **同じ export** を持ち、
     import 先を切替えるだけで挙動が差し替わる
   - TypeScript の **structural typing** と **ESM の named export** の組み合わせで実現する軽量 DI

4. **HTML を粗くテキスト化するだけで十分**
   - 完璧な変換を目指すと DOM パーサーが必要になり依存が増える
   - LLM はタグ含みでも意味を取れる
   - ノイズ混じりでも「ゼロ」よりは効果がある、という仮説を実験で検証する

5. **サイズキャップは必須**
   - 132KB のHTML → テキスト化後も 80KB 弱
   - そのまま system prompt に入れると毎回課金、context window もキツい
   - `MAX_PER_RESOURCE = 40KB` のような閾値で切る
   - 将来 embedding + retrieval へ進化させるなら、ここが置換点

---

## コミット

**実験中の import 切替はコミットしません**。実装・手順書の変更だけをコミット:

```bash
git add learn-aiagent/aiagent-and-mcp/aiagent/src/resource-loader.ts \
        learn-aiagent/aiagent-and-mcp/aiagent/src/resource-loader-ablation.ts \
        learn-aiagent/aiagent-and-mcp/aiagent/src/agent.ts \
        learn-aiagent/aiagent-and-mcp/aiagent/src/logger.ts

git commit -m "feat: アブレーション実験B用の resource-loader 2 モジュール + agent.ts import 切替構造"
```

---

## やってみる ✨

### 今できるようになったこと

- **import 1行の切替だけで MCP Resource 注入の有無を変えられる**
- 同じシグネチャの2モジュール（通常/アブレーション）で軽量 DI パターン
- 「情報量が引数精度に与える影響」を定量的に測定できる土台

### 3〜5分でできる比較

**Terminal B**（別タブ）:

```bash
tail -F logs/*.jsonl 2>/dev/null | jq -c 'select(.phase=="resources_loaded" or .phase=="resources_skipped" or .phase=="tool_call")'
```

**Terminal A**（通常）:

```bash
docker compose run --rm agent npm run dev -- "沖縄で予算4000円で鶏料理の会食候補を3つ"
```

**`aiagent/src/agent.ts` の import を切替えて実行**:

```bash
docker compose run --rm agent npm run dev -- "沖縄で予算4000円で鶏料理の会食候補を3つ"
```

**戻す**:

```bash
git checkout -- learn-aiagent/aiagent-and-mcp/aiagent/src/agent.ts
```

2回の `tool_call.args` を見比べて、特に `budget` パラメータの値が違うかに注目すると
リファレンス注入の効果が体感できます。

---

## ハンズオン完走！

Step 10 まで完走すると、以下がすべて揃います:

- PRD → 開発計画 → Step 1-8 本編 → Step 9-10 アブレーション実験
- MCP Tools / Resources の両方を実装
- Feature Toggle 2つ（import 切替）で実験比較可能
- 正常系連携テストで再現性保証
- ログ駆動の観察体系

おつかれさまでした。
次は **独自のアブレーション**を考えてみる（例: MAX_TURNS を変えたら？, healthy_filter を無効化したら？）
のも勉強になります。
