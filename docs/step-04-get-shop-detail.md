# Step 4: get_shop_detail ツール追加

> 上から順に読んで、コマンド・ファイル内容をそのままコピペすれば完了します。

## このStepで作るもの

### Step 4 完了時点のディレクトリ構造

```text
aiagent-handson/
├── .env
├── .env.example
├── .gitignore
├── docker-compose.yml
├── logs/
│   └── mcp-<timestamp>.jsonl  ← 実行するたびに1つ追加される
├── aiagent/
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
└── mcp/
    ├── Dockerfile
    ├── package.json
    ├── tsconfig.json
    ├── resources/
    │   └── gourmet-api.html
    └── src/
        ├── logger.ts
        ├── server.ts         ← 更新（このStep、get_shop_detail 分岐追加）
        ├── gourmet.ts      ← 更新（このStep、getShopDetail 関数追加）
        ├── tools.ts          ← 更新（このStep、GET_SHOP_DETAIL_TOOL 追加）
        └── check.ts          ← 更新（このStep、search → detail 連鎖）
```

### 作成・更新ファイル

- `mcp/src/gourmet.ts` に `getShopDetail(id)` を追加
- `mcp/src/tools.ts` に `GET_SHOP_DETAIL_TOOL` を追加
- `mcp/src/server.ts` の CallTool に `get_shop_detail` 分岐を追加
- `mcp/src/check.ts` で `search_shops` → 先頭店のIDを取って `get_shop_detail` に繋ぐ

このStep は「**ツール追加はパターン化できる**」ことを体験するのが目的です。

## 完了条件

- `docker compose run --rm mcp npm run check` が **2ツールとも呼べる**
- `tools: ["search_shops", "get_shop_detail"]` と表示
- search 結果の先頭店 ID で detail を取得できる

## 所要時間

約 15 分

## 前提条件

- Step 3 完了済み（`search_shops` が動く状態）
- `.env` に `GOURMET_API_KEY` 設定済み

---

## 手順

### 1. ディレクトリに移動

```bash
cd aiagent-handson/
```

### 2. `mcp/src/gourmet.ts` に `getShopDetail` を追加

既存の `searchShops` の後ろに追記します。ファイル末尾 `}` の後に続けて:

```bash
cat >> mcp/src/gourmet.ts << 'EOF'

export async function getShopDetail(
  id: string
): Promise<GourmetShop | null> {
  const apiKey = process.env.GOURMET_API_KEY;
  if (!apiKey) {
    throw new Error("GOURMET_API_KEY is not set");
  }

  const qs = new URLSearchParams({
    key: apiKey,
    format: "json",
    id,
  });

  const url = `${API_URL}?${qs.toString()}`;
  log("gourmet_api_request", {
    url: url.replace(apiKey, "[REDACTED]"),
    purpose: "detail",
  });

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `グルメ検索API error: ${res.status} ${await res.text()}`
    );
  }

  const data = (await res.json()) as GourmetResponse;

  if (data.results?.error && data.results.error.length > 0) {
    const err = data.results.error[0];
    throw new Error(`グルメ検索API error ${err.code}: ${err.message}`);
  }

  log("gourmet_api_response", {
    results_available: data.results?.results_available,
    results_returned: data.results?.results_returned,
    purpose: "detail",
  });

  // id 指定は1件のみ返る前提
  return data.results?.shop?.[0] ?? null;
}
EOF
```

**ポイント**:
- `URLSearchParams` に `id` を渡すだけ。`service_area` や `count` は不要（id指定が最優先される）
- `purpose: "detail"` ログタグで search / detail を区別できる（同じ `gourmet_api_request` phase だが用途が違う）
- 戻り値は **単一店舗 or null**。「見つからなかった」を型で表現

### 3. `mcp/src/tools.ts` に `GET_SHOP_DETAIL_TOOL` を追加

既存 `SEARCH_SHOPS_TOOL` の後に追記します:

```bash
cat >> mcp/src/tools.ts << 'EOF'

/**
 * get_shop_detail ツール定義
 *
 * 店舗IDから単一店舗の詳細情報を取得する。
 * search_shops の結果から選んだ店の詳しい情報を拾うときに使う。
 */
export const GET_SHOP_DETAIL_TOOL: Tool = {
  name: "get_shop_detail",
  description: `グルメ の店舗IDから単一店舗の詳細情報を取得する。

【使うタイミング】
- search_shops で見つけた店舗の詳しい情報を追加で見たい時
- 会食判定のために追加属性（営業時間、個室有無など）が必要な時

【返却内容】
- 単一店舗の全属性（店舗名、ジャンル、キャッチ、住所、URL、予算、...）
- 該当IDが存在しない場合は "Shop not found"

【制約】
- 1回の呼び出しで1店舗のみ
- id は必ず search_shops の結果に含まれる shop.id を指定すること`,
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "グルメ の店舗ID（例: "J000000000"）",
      },
    },
    required: ["id"],
  },
};
EOF
```

**ポイント**:
- `required: ["id"]` で必須を明示。LLM が省略できない
- description に「search_shops の結果から取った ID を使う」ことを明記し、2ツールの**連携パターン**を示す

### 4. `mcp/src/server.ts` を書き直す

server.ts は全体を差し替えます:

```bash
cat > mcp/src/server.ts << 'EOF'
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GET_SHOP_DETAIL_TOOL, SEARCH_SHOPS_TOOL } from "./tools.ts";
import {
  getShopDetail,
  searchShops,
  type SearchShopsParams,
} from "./gourmet.ts";
import { log } from "./logger.ts";

async function main() {
  const server = new Server(
    { name: "kaishoku-mukimuki-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  // ツール一覧。Step 4 で search_shops と get_shop_detail の2つ
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log("list_tools", { count: 2 });
    return { tools: [SEARCH_SHOPS_TOOL, GET_SHOP_DETAIL_TOOL] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log("call_tool_received", { name, args });

    if (name === "search_shops") {
      try {
        const params = (args ?? {}) as SearchShopsParams;
        const shops = await searchShops(params);
        log("call_tool_done", { name, count: shops.length });
        return {
          content: [
            { type: "text", text: JSON.stringify(shops, null, 2) },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log("call_tool_error", { name, message });
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }

    if (name === "get_shop_detail") {
      try {
        const id = String((args as { id?: unknown })?.id ?? "");
        if (!id) {
          throw new Error("id is required");
        }
        const shop = await getShopDetail(id);
        log("call_tool_done", { name, found: shop !== null });
        return {
          content: [
            {
              type: "text",
              text: shop
                ? JSON.stringify(shop, null, 2)
                : "Shop not found",
            },
          ],
          isError: shop === null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log("call_tool_error", { name, message });
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        };
      }
    }

    log("call_tool_unknown", { name });
    return {
      content: [
        { type: "text", text: `Not Implemented: ${name}` },
      ],
      isError: true,
    };
  });

  await server.connect(new StdioServerTransport());
  log("server_started", { transport: "stdio" });
}

main().catch((err) => {
  log("fatal", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
EOF
```

**ポイント**:
- **ツール追加は分岐を足すだけ**。search_shops と同じパターンで get_shop_detail を追加
- Shop not found は `isError: true` で返す。「呼び出しは成功したが業務的に見つからなかった」を表現
- ListTools の `count` を 2 に更新（ログで確認用）

### 5. `mcp/src/check.ts` を書き直す

search → 先頭店舗のID → detail の連鎖を確認します:

```bash
cat > mcp/src/check.ts << 'EOF'
/**
 * MCPサーバー疎通確認スクリプト
 *
 * 自分自身を MCP クライアントとして起動し、サーバーを stdio でspawn して
 * listTools と callTool（2ツール）を実行する。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["src/server.ts"],
    env: {
      ...process.env,
      GOURMET_API_KEY: process.env.GOURMET_API_KEY ?? "",
    } as Record<string, string>,
  });

  const client = new Client(
    { name: "mcp-check-client", version: "0.1.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("[check] connected to MCP server");

  // tools/list
  const toolsRes = await client.listTools();
  console.log(
    "[check] tools:",
    toolsRes.tools.map((t) => t.name)
  );

  // tools/call search_shops
  console.log("[check] calling search_shops (keyword="鶏", count=3)...");
  const result = await client.callTool({
    name: "search_shops",
    arguments: { keyword: "鶏", count: 3 },
  });

  const content = result.content as Array<{ type: string; text: string }>;
  if (result.isError) {
    console.error("[check] ERROR:", content[0]?.text);
    await client.close();
    process.exit(1);
  }

  const shops = JSON.parse(content[0]?.text ?? "[]");
  console.log(`[check] got ${shops.length} shops:`);
  for (const shop of shops) {
    console.log(
      `  - ${shop.name} (${shop.genre?.name}) / ${shop.budget?.average}`
    );
  }

  // tools/call get_shop_detail（search結果から先頭店の詳細を取得）
  if (shops.length === 0) {
    console.error("[check] no shops returned; skipping get_shop_detail");
    await client.close();
    return;
  }

  const firstShopId = shops[0].id;
  console.log(`[check] calling get_shop_detail (id="${firstShopId}")...`);
  const detailResult = await client.callTool({
    name: "get_shop_detail",
    arguments: { id: firstShopId },
  });

  const detailContent = detailResult.content as Array<{
    type: string;
    text: string;
  }>;
  if (detailResult.isError) {
    console.error("[check] detail ERROR:", detailContent[0]?.text);
    await client.close();
    process.exit(1);
  }

  const shop = JSON.parse(detailContent[0]?.text ?? "null");
  console.log(`[check] shop detail:`);
  console.log(`  name:    ${shop.name}`);
  console.log(`  genre:   ${shop.genre?.name}`);
  console.log(`  catch:   ${shop.catch}`);
  console.log(`  address: ${shop.address}`);
  console.log(`  url:     ${shop.urls?.pc}`);

  await client.close();
}

main().catch((err) => {
  console.error("[check] fatal", err);
  process.exit(1);
});
EOF
```

**ポイント**:
- `search_shops` の結果から **動的にIDを拾う**ので、毎回違う店の詳細になる
- 検索結果が0件だった場合は detail 呼び出しをスキップする安全設計
- Agent (Step 6) がやる「search → detail」の流れを、疎通テストでも再現

---

## 動作確認

```bash
docker compose run --rm mcp npm run check
```

期待する出力（店舗は日々変わります）:

```
> mcp@0.1.0 check
> node src/check.ts

{"ts":"...","source":"mcp","phase":"server_started","desc":"MCPサーバー起動（stdio）","transport":"stdio"}
[check] connected to MCP server
{"ts":"...","source":"mcp","phase":"list_tools","desc":"ツール一覧をクライアントへ応答","count":2}
[check] tools: [ 'search_shops', 'get_shop_detail' ]
[check] calling search_shops (keyword="鶏", count=3)...
{"ts":"...","source":"mcp","phase":"call_tool_received","desc":"ツール呼び出しを受信","name":"search_shops",...}
{"ts":"...","source":"mcp","phase":"gourmet_api_request","desc":"グルメ検索API へリクエスト送信","url":"...[REDACTED]...&keyword=%E9%B6%8F"}
{"ts":"...","source":"mcp","phase":"gourmet_api_response","desc":"グルメ検索API からレスポンス受信","results_available":46,"results_returned":"3"}
{"ts":"...","source":"mcp","phase":"call_tool_done","desc":"ツール実行が正常完了","name":"search_shops","count":3}
[check] got 3 shops:
  - とりいちず 与那原店 (居酒屋) / 通常2000円・宴会3000円
  - とりいちず 沖縄胡屋店 (居酒屋) / 通常2000円・宴会3000円
  - 地鶏備長とり幻 (和食) / 4000-5000円
[check] calling get_shop_detail (id="J004510169")...
{"ts":"...","source":"mcp","phase":"call_tool_received","desc":"ツール呼び出しを受信","name":"get_shop_detail","args":{"id":"J004510169"}}
{"ts":"...","source":"mcp","phase":"gourmet_api_request","desc":"グルメ検索API へリクエスト送信","url":"...&id=J004510169","purpose":"detail"}
{"ts":"...","source":"mcp","phase":"gourmet_api_response","desc":"グルメ検索API からレスポンス受信","results_available":1,"results_returned":"1","purpose":"detail"}
{"ts":"...","source":"mcp","phase":"call_tool_done","desc":"ツール実行が正常完了","name":"get_shop_detail","found":true}
[check] shop detail:
  name:    とりいちず 与那原店
  genre:   居酒屋
  catch:   ドリンク109円革命！ 鶏料理専門店の水炊き
  address: 沖縄県島尻郡与那原町上与那原336　ウイングビル与那原2階
  url:     <店舗詳細URL>
```

2ツールが呼ばれ、`shop detail` に URL まで含めて表示されれば **Step 4 完了** です。

---

## ログ観察タブ（Terminal B）

### このStepから増えるログ phase

Step 3 の phase に加え、以下のバリエーションが出ます:

| phase | 追加されるバリエーション |
|---|---|
| `list_tools` | `count: 2` になる（Step 3 は `count: 1`） |
| `call_tool_received` | `name: "get_shop_detail"` が登場 |
| `gourmet_api_request` | `purpose: "detail"` タグが付く版が登場 |
| `gourmet_api_response` | `purpose: "detail"` タグ付き、`results_available: 1` |
| `call_tool_done` | `found: true / false` で検索成否を返す |

### Terminal B で実行するコマンド

```bash
cd aiagent-handson/
tail -F logs/mcp-*.jsonl 2>/dev/null
# jq 整形版:
# tail -F logs/mcp-*.jsonl 2>/dev/null | jq -r '"\(.ts) [\(.phase)] \(. | del(.ts, .source, .phase) | tostring)"'
```

### 観察ポイント

- **同じ `gourmet_api_request` phase が2回出る** が、`purpose` が付くものと付かないもので **search か detail か** 判別できる
- `results_available` が search は数十〜数千、detail は 1（必ず）

---

## トラブルシュート

| 症状 | 原因候補 | 対処 |
|---|---|---|
| `tools: ['search_shops']` のまま 1ツール | `server.ts` の ListTools 更新忘れ | 手順4の cat を再実行 |
| `id is required` エラー | `search_shops` が0件で空配列返却 | keyword を変える（例: `居酒屋`） |
| `get_shop_detail` が `Shop not found` | ID が無効 or API仕様変更 | ID 文字列を手元の結果で検証 |
| `results_available: 0`（detail側） | ID typo or APIキー不正 | `check.ts` に手書きで known-good ID を入れてテスト |

---

## このStepでの勘どころ

1. **ツール追加はパターン化できる**
   - 新しいツールは「gourmet.ts に関数追加 → tools.ts に定義追加 → server.ts に分岐追加」の3点だけ
   - Step 3 と Step 4 の変更差分が非常に近い。この再現性こそが MCP の価値

2. **ツール間の連携は LLM ではなく ID 渡しで繋ぐ**
   - `search_shops` の結果から拾った `shop.id` を `get_shop_detail` に渡す
   - これは Agent がやる tool calling ループのミニチュア版
   - Step 6 で Agent が LLM経由で同じ流れをするが、**疎通テストでは決定的に繋げる**のが定石

3. **`purpose` ログタグで同一 phase を区別**
   - search と detail の `gourmet_api_request` は同じ phase 名
   - `purpose` で区別できるようにしておくと、監視・集計で役に立つ
   - Step 7 以降の連携テストで **search 何回/detail 何回** を集計できる

4. **`isError: true` でビジネス的「見つからない」を表現**
   - throw すると通信エラー扱いになる
   - MCPクライアント側で業務エラーと通信エラーを分けられることが、Agent が再試行判断するときに効く

5. **疎通テストは search → detail の順で書く**
   - 新規ツールだけ単独テストしても「繋がっているか」は分からない
   - **前後のツールと連携させて**初めて実運用に近い確認になる

---

## コミット

### 実装コミット（feat）

```bash
git add mcp/src/gourmet.ts \
        mcp/src/tools.ts \
        mcp/src/server.ts \
        mcp/src/check.ts

git commit -m "feat: Step4 get_shop_detail ツール追加"
```

### 手順書コミット（docs）

```bash
git add procedure-docs/step-04-get-shop-detail.md \
        dev-plan-v2.md

git commit -m "docs: Step4 手順書追加"
```

---

## やってみる ✨

### 今できるようになったこと

- MCPツール **`search_shops`** で沖縄の店舗を検索
- **`get_shop_detail`** で選んだ店の詳細情報を取得
- 2ツールを **連携させて使う**パターンを体得

### 1分でできる確認

**Terminal B**:

```bash
cd aiagent-handson/
tail -F logs/mcp-*.jsonl 2>/dev/null
```

**Terminal A**:

```bash
docker compose run --rm mcp npm run check
```

Terminal A に **店舗一覧3件 + 先頭店の詳細（住所・URLまで）** が出て、
Terminal B に **2種類のツール呼び出し** が時系列で流れる。

`purpose: "detail"` タグの有無で、同じ phase が **search の呼び出しと detail の呼び出し** で区別できるのを目視確認。

---

## 次のStep

→ [Step 5: Agent最小（Responses API疎通）](./step-05-agent-minimal.md)（Step 5 完了後に作成）
