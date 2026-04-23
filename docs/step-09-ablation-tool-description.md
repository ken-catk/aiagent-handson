# Step 9: アブレーション実験A — Tool Description の情報量削減

> **アブレーション（ablation）** = 機械学習/AI研究で使う標準用語。
> システムの一部を取り除いて性能差を測る実験手法。
> ここでは「Tool Description を詳細版 → 曖昧版」に切り替えて、
> LLM の挙動がどう変化するかを観察します。
>
> **切替方法**: `mcp/src/server.ts` の import **コメントを1行入れ替え**。
> 環境変数は使いません（Biome 保護下で format-on-save と衝突しない）。

## このStepで作るもの

### Step 9 完了時点のディレクトリ構造

```text
learn-aiagent/aiagent-and-mcp/
├── ... (Step 8 完了状態のまま)
└── mcp/
    └── src/
        ├── tools.ts                   （通常版、変更なし）
        ├── tools-ablation-desc.ts     ← 新規（このStep、曖昧版）
        └── server.ts                  ← 更新（このStep、import コメント切替で実験モード）
```

### 作成・更新ファイル

- `mcp/src/tools-ablation-desc.ts` — 曖昧版 Tool 定義（description 1行のみ、parameters 単語のみ）
- `mcp/src/server.ts` — アブレーション時に import を切替える構造にする

## 完了条件

- 通常モード: `server.ts` が `./tools.ts` を import → 詳細な description で動く
- アブレーションモード: `./tools-ablation-desc.ts` を import → 曖昧 description で動く
- どちらのモードも `docker compose run --rm agent npm run dev -- "..."` で動作
- `git checkout -- server.ts` で一発で戻せる
- `list_tools` ログの `desc_lengths` で現在のモードが判別できる

## 所要時間

約 15〜20 分（観察と比較含む）

## 前提条件

- Step 8 完了済み（`./tests/run-normal.sh` が PASS する正常系基準値がある）
- 2 ターミナル運用に慣れている

---

## 実験の狙い

**仮説**: Tool Description は「LLMとの契約書」として動作する。
情報量を削ると以下の悪影響が予測される:

| 観点 | 予測される変化 |
|---|---|
| LLM の引数生成 | description の例が無いため、不適切な値を入れがち（`budget`に "安い" など） |
| ツール選択 | `search_shops` と `get_shop_detail` の使い分けが曖昧になる |
| リトライ回数 | 引数が合わず0件 → 再試行で MAX_TURNS 到達 |
| 最終応答の精度 | 情報不足で冗長/不正確な応答 |

これを **実測で検証**するのが目的です。

---

## 手順

### 1. ディレクトリに移動

```bash
cd learn-aiagent/aiagent-and-mcp
```

### 2. 曖昧版ツール定義ファイルを作成

```bash
cat > mcp/src/tools-ablation-desc.ts << 'EOF'
/**
 * Ablation 版ツール定義（Step 9: Tool Description 情報量削減）
 *
 * 元の tools.ts から description と parameters.description を
 * 最小限に削り、LLM に与える情報量を絞った版。
 *
 * 使い方: server.ts の冒頭で import コメントを入れ替える
 * （元に戻すには: git checkout -- mcp/src/server.ts）
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const SEARCH_SHOPS_TOOL: Tool = {
  name: "search_shops",
  description: "店を検索する",
  inputSchema: {
    type: "object",
    properties: {
      keyword: { type: "string", description: "キーワード" },
      budget: { type: "string", description: "予算" },
      count: { type: "number", description: "数" },
    },
  },
};

export const GET_SHOP_DETAIL_TOOL: Tool = {
  name: "get_shop_detail",
  description: "詳細を取る",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "ID" },
    },
    required: ["id"],
  },
};
EOF
```

**ポイント**:
- description は **1行のみ、具体例なし、制約なし**
- parameters.description も単語レベル（「キーワード」「予算」「数」）
- 通常版 `tools.ts` は**変更なし**、両版を共存

### 3. `server.ts` の import 部分を「切替可能な形」に更新

既存の import 行を以下の2行セットに置き換えます:

```typescript
// ─────────────────────────────────────────────────────────────────────
// アブレーション実験A: Tool Description の情報量削減
// ─────────────────────────────────────────────────────────────────────
// 通常モード: ./tools.ts を import
// アブレーション: 下の行をコメントアウトし、`./tools-ablation-desc.ts` の方を有効化
// （元に戻すには: git checkout -- mcp/src/server.ts）
import { GET_SHOP_DETAIL_TOOL, SEARCH_SHOPS_TOOL } from "./tools.ts";
// import { GET_SHOP_DETAIL_TOOL, SEARCH_SHOPS_TOOL } from "./tools-ablation-desc.ts";
```

さらに `list_tools` のログに `desc_lengths` を追加して、**現在のモードをログで判別可能**にします:

```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => {
  log("list_tools", {
    count: 2,
    // どの tools モジュールから来た定義かは description の長さで判別可能
    desc_lengths: [
      SEARCH_SHOPS_TOOL.description?.length ?? 0,
      GET_SHOP_DETAIL_TOOL.description?.length ?? 0,
    ],
  });
  return { tools: [SEARCH_SHOPS_TOOL, GET_SHOP_DETAIL_TOOL] };
});
```

**設計ポイント**:
- import 1行のコメント位置を入れ替えるだけで実験モード切替
- `git checkout -- mcp/src/server.ts` で元に戻せる
- `desc_lengths` で後からログを見ても条件が分かる（通常: `[~250, ~260]`、アブレーション: `[6, 5]`）
- Biome の format-on-save はコメントアウトされた import を壊さない

### 4. 再ビルド不要

volume マウント構成でコードは即反映。依存は追加なし。

---

## 動作確認

### 通常モード（初期状態）

```bash
docker compose run --rm agent npm run dev -- "沖縄で刺身が美味しい店を3つ教えて"
```

ログに `desc_lengths` が大きい値（例: `[251, 263]`）で出ることを確認:

```bash
ls -t logs/mcp-*.jsonl | head -1 | xargs grep '"phase":"list_tools"'
```

### アブレーションモードに切替

`mcp/src/server.ts` の冒頭2行のコメントを入れ替え:

**Before**（通常）:
```typescript
import { GET_SHOP_DETAIL_TOOL, SEARCH_SHOPS_TOOL } from "./tools.ts";
// import { GET_SHOP_DETAIL_TOOL, SEARCH_SHOPS_TOOL } from "./tools-ablation-desc.ts";
```

**After**（アブレーション）:
```typescript
// import { GET_SHOP_DETAIL_TOOL, SEARCH_SHOPS_TOOL } from "./tools.ts";
import { GET_SHOP_DETAIL_TOOL, SEARCH_SHOPS_TOOL } from "./tools-ablation-desc.ts";
```

VSCode で保存すると Biome が自動整形しますが、import パスは変わりません。

### アブレーションモード実行

```bash
docker compose run --rm agent npm run dev -- "沖縄で刺身が美味しい店を3つ教えて"
```

ログの `desc_lengths` が短い値（`[6, 5]`）に変わっていることを確認:

```bash
ls -t logs/mcp-*.jsonl | head -1 | xargs grep '"phase":"list_tools"'
```

### 元に戻す

```bash
git checkout -- mcp/src/server.ts
```

これで通常モードに戻ります。

両モードが動けば **Step 9 のセットアップ完了**。以降は実験・観察フェーズです。

---

## ログ観察タブ（Terminal B）

別タブで起動:

```bash
cd learn-aiagent/aiagent-and-mcp
tail -F logs/*.jsonl 2>/dev/null | jq -c 'select(.phase=="list_tools" or .phase=="tool_call" or .phase=="filter_applied" or .phase=="agent_done")'
```

### 注目する phase

- `list_tools` の `desc_lengths` — モードの証拠（長い=通常、短い=アブレーション）
- `tool_call` の `args` — LLM がどの引数を選んだか
- `filter_applied` の `input_count` / `output_count` — フィルタ結果
- `agent_done` の `turns` — 何ターンで終了したか

---

## 観察記録シート

同じプロンプトで通常版 vs 曖昧版を比較:

### プロンプト

```
<ここに使ったプロンプトを書く。推奨: 「沖縄で刺身が美味しい店を3つ教えて」>
```

### 結果比較

| 観点 | 通常版（`tools.ts`） | 曖昧版（`tools-ablation-desc.ts`） | 差分メモ |
|---|---|---|---|
| `list_tools.desc_lengths` | | | |
| 初回 tool_call の args（keyword/budget/count） | | | |
| ターン数（agent_done.turns） | | | |
| filter_applied input_count | | | |
| filter_applied output_count | | | |
| 最終応答の content_length | | | |
| 最終応答に店舗が含まれた？ | | | |
| 応答に誤った情報があった？ | | | |
| hit_keywords が応答に明記された？ | | | |
| muscle_comment が応答に明記された？ | | | |

### 主観評価

- 応答の質: 通常版 ( / 5) vs 曖昧版 ( / 5)
- 会食ムキムキ君らしさ: 通常版 ( / 5) vs 曖昧版 ( / 5)
- 気づき: 

### 複数回実行推奨

LLM 応答は temperature=0 でも微妙にブレるので、**各モード3回ずつ実行**して平均で比較するのが安全です。

---

## 戻し方（次の実験に備える）

`git checkout` で一発:

```bash
git checkout -- mcp/src/server.ts
```

`tools-ablation-desc.ts` は次の再実験や他のアブレーション課題のためにリポジトリに残しておきます（削除不要）。

---

## トラブルシュート

| 症状 | 原因候補 | 対処 |
|---|---|---|
| `Cannot find module './tools-ablation-desc.ts'` | ファイル作成忘れ | 手順2 を実行 |
| import を切替えたのに desc_lengths が変わらない | 両方の行をコメントアウトした or 両方有効化した | `server.ts` を開いて**有効な import は1行だけ**であることを確認 |
| 曖昧版でも通常と変わらない | LLM が元々賢い、プロンプトがヒント過多 | プロンプトを最小化（例: 「沖縄で店教えて」） |
| VSCode が server.ts を勝手に整形する | Biome format-on-save | そのままでOK（Biomeはコメント済み import を壊さない）|

---

## このStepでの勘どころ

1. **import コメント入れ替えは Feature Toggle の軽量版**
   - コード変更が git diff に明白に残る → 研究・教育向き
   - 実験条件が「今どのモードか」を見ればすぐ分かる
   - 環境変数方式と比べて**コード本体の複雑度が激減**（alias import や conditional が不要）

2. **Biome の format-on-save と相性が良い**
   - 古典的な ESLint + Prettier は auto-import で実験を壊しやすかった
   - Biome の format-on-save は**コメント済み import を保持**するだけ
   - Feature Toggle 的な実験コードが書きやすい環境に変わった

3. **アブレーション = 設計判断の根拠を測る手法**
   - 「description は詳細であるべき」は直感
   - **実測するとどれくらい重要か**が分かる
   - ステークホルダー説得・レビュー対応の定量根拠になる

4. **ログに「モードが何か」の証拠を残す**
   - `list_tools` の `desc_lengths` でログから条件が判別できる
   - 後日ログを見返すとき「これどのモードだっけ？」にならない
   - 実験再現性・観察再現性の両方に効く

5. **定量 + 定性の両輪で観察**
   - 定量: ターン数、input/output_count、content_length、desc_lengths
   - 定性: 応答の「らしさ」、ハルシネーションの有無、引数の妥当性
   - 両方記録することで「数値は同じでも質が落ちる」を見逃さない

---

## コミット

**実験中の import 切替はコミットしません**。実装・手順書の変更だけをコミット:

```bash
git add learn-aiagent/aiagent-and-mcp/mcp/src/tools-ablation-desc.ts \
        learn-aiagent/aiagent-and-mcp/mcp/src/server.ts

git commit -m "feat: アブレーション実験A用の曖昧版ツール定義と import 切替構造"
```

---

## やってみる ✨

### 今できるようになったこと

- **import 1行の切替だけで Tool Description の詳細度を変えられる**
- 変更が **git diff に明白**、`git checkout` で確実に戻る
- VSCode Biome 保存と喧嘩せずに実験できる
- `list_tools.desc_lengths` ログで後からモード判別可能

### 3〜5分でできる比較

**Terminal B**（別タブ）:

```bash
tail -F logs/*.jsonl 2>/dev/null | jq -c 'select(.phase=="list_tools" or .phase=="tool_call")'
```

**Terminal A**（通常モード）:

```bash
docker compose run --rm agent npm run dev -- "沖縄で刺身が美味しい店を3つ教えて"
# → desc_lengths が長い値
```

**import を切替えて実行**（`mcp/src/server.ts` の2行のコメントを入れ替え）:

```bash
docker compose run --rm agent npm run dev -- "沖縄で刺身が美味しい店を3つ教えて"
# → desc_lengths が短い値
```

**戻す**:

```bash
git checkout -- learn-aiagent/aiagent-and-mcp/mcp/src/server.ts
```

2回の結果を見比べて、`tool_call.args` の質・ターン数・filter 結果の具体的な数値差を
観察シートに記入すれば実験完了。

---

## 次のStep

→ [Step 10: アブレーション実験B — MCP Resource参照の削減](./step-10-ablation-mcp-resource.md)
