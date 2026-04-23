# Step 3: グルメラッパ + search_shops ツール

> 上から順に読んで、コマンド・ファイル内容をそのままコピペすれば完了します。

## このStepで作るもの

### Step 3 完了時点のディレクトリ構造

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
    ├── package.json          ← 更新（scripts.check 追加）
    ├── tsconfig.json
    ├── resources/                 ← 新規（このStep、MCP Resource 公開用）
    │   └── gourmet-api.html         ← Slack で配布（MCP Resource として公開）
    └── src/
        ├── logger.ts         （Step 2 で作成済、resource 関連の phase 追加）
        ├── server.ts         ← 更新（このStep、search_shops + ListResources/ReadResource）
        ├── gourmet.ts      ← 新規（このStep、グルメ検索APIクライアント）
        ├── tools.ts          ← 新規（このStep、ツール定義）
        └── check.ts          ← 新規（このStep、ツール + リソースの疎通確認）
```

### 作成・更新ファイル

- `mcp/resources/gourmet-api.html` — **Slack で配布される グルメ 公式リファレンス HTML**（MCP Resource として公開）
- `mcp/src/gourmet.ts` — グルメ検索APIクライアント
- `mcp/src/tools.ts` — MCPツール定義（`SEARCH_SHOPS_TOOL`）
- `mcp/src/server.ts` — ツール配線 + **ListResources / ReadResource ハンドラ**（更新）
- `mcp/src/check.ts` — 疎通確認スクリプト（`listResources` / `readResource` 呼び出し含む）
- `mcp/package.json` に `scripts.check` 追加

## 完了条件

- `docker compose run --rm mcp npm run check` で沖縄の店舗一覧がJSONで返る
- 件数・店舗名・ジャンル・予算が表示される

## 所要時間

約 25 分

## 前提条件

- Step 2 完了済み（MCPサーバーが起動する状態）
- `.env` に `GOURMET_API_KEY` が設定済み
- グルメ検索API キーは取得済み（<登録ページ（Slack で配布）> で取得）

---

## 手順

### 1. ディレクトリに移動

```bash
cd aiagent-handson/
```

### 2. グルメ検索API リファレンス HTML を配置

**Slack で配布される `gourmet-api.html`** を `mcp/resources/` に置きます。

```bash
mkdir -p mcp/resources

# 配布されたファイルを mcp/resources/gourmet-api.html に配置
# 例: Slack からダウンロードした後に
#   mv ~/Downloads/gourmet-api.html mcp/resources/gourmet-api.html
```

**配置後の確認**:

```bash
ls -la mcp/resources/gourmet-api.html
# → 130KB 程度のファイルがあればOK
```

**このファイルは何か**:
- グルメ検索API の公式リファレンス HTML（3,500行超）
- エリアコード（`SA11`〜`SA98`）・予算コード（`B001`〜`B014`）・パラメータ仕様・エラーコード等を網羅
- **MCP Resource として LLM/クライアントから参照可能**に公開する
  - LLM が API の細部（コードの意味や取りうる値）を正しく理解するための参照情報
  - 参加者が同じファイルを持つ状態を作るため、Slack で一括配布

コード中にこのファイルの中身は貼りません（大きすぎる + 受講者は Slack で受け取る前提）。

### 3. `mcp/src/gourmet.ts` を作成

```bash
cat > mcp/src/gourmet.ts << 'EOF'
/**
 * グルメ検索API クライアント
 *
 * API URL と API キーは .env で設定する（Slack で配布される登録情報を参照）。
 */

import { log } from "./logger.ts";

function getApiUrl(): string {
  const url = process.env.GOURMET_API_URL;
  if (!url) {
    throw new Error("GOURMET_API_URL is not set");
  }
  return url;
}

// 沖縄全体のサービスエリアコード
// 値は公式のマスター API から取得した既知の定数
const OKINAWA_SERVICE_AREA = "SA98";

export interface SearchShopsParams {
  keyword?: string;
  budget?: string;
  count?: number;
}

export interface GourmetShop {
  id: string;
  name: string;
  genre: {
    name: string;
    catch: string;
  };
  catch: string;
  address: string;
  urls: {
    pc: string;
  };
  budget: {
    code: string;
    name: string;
    average: string;
  };
  [key: string]: unknown;
}

interface GourmetResponse {
  results?: {
    shop?: GourmetShop[];
    error?: Array<{ code: string; message: string }>;
    results_available?: number;
    results_returned?: string;
  };
}

export async function searchShops(
  params: SearchShopsParams
): Promise<GourmetShop[]> {
  const apiKey = process.env.GOURMET_API_KEY;
  if (!apiKey) {
    throw new Error("GOURMET_API_KEY is not set");
  }

  const qs = new URLSearchParams({
    key: apiKey,
    format: "json",
    service_area: OKINAWA_SERVICE_AREA,
    count: String(params.count ?? 10),
  });
  if (params.keyword) qs.set("keyword", params.keyword);
  if (params.budget) qs.set("budget", params.budget);

  const url = `${API_URL}?${qs.toString()}`;
  // logger が REDACT するが、念のためここでも置換しておく
  log("gourmet_api_request", { url: url.replace(apiKey, "[REDACTED]") });

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
  });

  return data.results?.shop ?? [];
}
EOF
```

**ポイント**:

- エリアコードは **`SA98`**（沖縄）。過去に `SA49` と誤っていた場合はAPIが 0件を返すだけでエラーにならないため、`results_available` をログに出して気づけるようにしている
- `fetch` は Node 24 組み込み（外部ライブラリ不要）
- `URLSearchParams` で安全にクエリ構築（キーワードの URL エンコード自動化）
- APIキーは `[REDACTED]` 置換でログから除外

### 4. `mcp/src/tools.ts` を作成

```bash
cat > mcp/src/tools.ts << 'EOF'
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * search_shops ツール定義
 *
 * Tool Descriptionは「LLMとの契約書」。
 * 使うタイミング・返却内容・制約を曖昧語なく明記する。
 */
export const SEARCH_SHOPS_TOOL: Tool = {
  name: "search_shops",
  description: `沖縄エリアのレストラン・居酒屋・飲食店を、キーワードや予算で検索する。

【使うタイミング】
- ユーザーが会食候補の店を探している時
- 店舗一覧を元にフィルタリング判断する材料を揃えたい時

【返却内容】
- 店舗の配列（id, 店舗名, ジャンル, キャッチ, 住所, URL, 平均予算）

【制約】
- 検索エリアは沖縄全体（service_area=SA98）固定
- 最大返却件数は count パラメータ（既定10、上限30）
- count を超える値を指定しても内部で30件に丸める`,
  inputSchema: {
    type: "object",
    properties: {
      keyword: {
        type: "string",
        description: "検索キーワード。例: "鶏", "刺身", "居酒屋"",
      },
      budget: {
        type: "string",
        description:
          "グルメ 予算コード。例: "B002"=2001〜3000円, "B003"=3001〜4000円",
      },
      count: {
        type: "number",
        description: "返却件数（1〜30）。既定は10。",
        minimum: 1,
        maximum: 30,
      },
    },
  },
};
EOF
```

**ポイント**:

- `description` に **「使うタイミング」「返却内容」「制約」** の3ブロックを明示
- LLM が「いつ呼ぶか」「何を受け取れるか」を迷わない
- `inputSchema.properties[].description` で各パラメータの具体例を示す（LLMの引数生成精度が上がる）

### 5. `mcp/src/server.ts` を更新

Step 2 の `server.ts` を書き換えます。

```bash
cat > mcp/src/server.ts << 'EOF'
import { promises as fs } from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SEARCH_SHOPS_TOOL } from "./tools.ts";
import { searchShops, type SearchShopsParams } from "./gourmet.ts";
import { log } from "./logger.ts";

// MCP Resource として公開する グルメ検索API リファレンス
// ファイル本体は Slack で配布し mcp/resources/gourmet-api.html に配置する運用
const GOURMET_REFERENCE_URI = "file:///app/resources/gourmet-api.html";
const GOURMET_REFERENCE_PATH = path.join(process.cwd(), "resources", "gourmet-api.html");

async function main() {
  const server = new Server(
    { name: "kaishoku-mukimuki-mcp", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  // ツール一覧。現時点は search_shops のみ。Step 4 で get_shop_detail を追加
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log("list_tools", { count: 1 });
    return { tools: [SEARCH_SHOPS_TOOL] };
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

    log("call_tool_unknown", { name });
    return {
      content: [
        { type: "text", text: `Not Implemented: ${name}` },
      ],
      isError: true,
    };
  });

  // MCP Resource: グルメ検索API リファレンスを公開
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    log("list_resources", { count: 1 });
    return {
      resources: [
        {
          uri: GOURMET_REFERENCE_URI,
          name: "グルメ検索API リファレンス",
          description:
            "グルメ検索API の公式リファレンス HTML。エリアコード・予算コード・パラメータ仕様を網羅。",
          mimeType: "text/html",
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    log("read_resource_received", { uri });

    if (uri !== GOURMET_REFERENCE_URI) {
      log("read_resource_error", { uri, reason: "unknown_uri" });
      throw new Error(`Unknown resource URI: ${uri}`);
    }

    try {
      const text = await fs.readFile(GOURMET_REFERENCE_PATH, "utf8");
      log("read_resource_done", { uri, bytes: text.length });
      return {
        contents: [{ uri, mimeType: "text/html", text }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("read_resource_error", { uri, message });
      throw new Error(`Failed to read resource ${uri}: ${message}`);
    }
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

- `try/catch` で **業務エラー**（`isError: true`）として返す。例外をそのまま throw するとMCPクライアントが通信エラーと区別できない
- `Not Implemented` 分岐は残す。将来ツールが増えた時のフォールバック
- ツール結果は `JSON.stringify(shops, null, 2)` で**整形済みテキスト**。LLMが読みやすい
- **`capabilities.resources: {}`** でリソース機能を宣言（これが無いとクライアントから見えない）
- **`ListResourcesRequestSchema`** ハンドラで公開リソース一覧を返す
- **`ReadResourceRequestSchema`** ハンドラで URI を受けてファイル内容を返す
  - 未知の URI は throw（MCP仕様の標準的な失敗報告）
  - ログに bytes を残すと後で「巨大ファイルが毎回読まれている」などの異常が検知できる

### 6. `mcp/src/check.ts` を作成（疎通確認用）

```bash
cat > mcp/src/check.ts << 'EOF'
/**
 * MCPサーバー疎通確認スクリプト
 *
 * 自分自身を MCP クライアントとして起動し、サーバーを stdio でspawn して
 * listTools と callTool を実行する。
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

  // resources/list（MCP Resource 機能の疎通確認）
  const resourcesRes = await client.listResources();
  console.log(
    "[check] resources:",
    resourcesRes.resources.map((r) => r.uri)
  );

  // 先頭リソースの読み取りを1回試す（サイズだけ表示）
  if (resourcesRes.resources.length > 0) {
    const firstUri = resourcesRes.resources[0].uri;
    const readRes = await client.readResource({ uri: firstUri });
    const firstContent = readRes.contents[0] as { text?: string };
    const size = firstContent.text?.length ?? 0;
    console.log(`[check] read resource ${firstUri}: ${size} bytes`);
  }

  // tools/call search_shops（キーワード絞り込み疎通確認）
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

  await client.close();
}

main().catch((err) => {
  console.error("[check] fatal", err);
  process.exit(1);
});
EOF
```

**ポイント**:

- `StdioClientTransport` が **サーバープロセスを spawn** する。`command: "node", args: ["src/server.ts"]` で server.ts を子プロセスとして起動
- `env` に `GOURMET_API_KEY` を明示的に渡す（子プロセスに環境変数を継承させる）
- `client.close()` は stdio サブプロセスも一緒に終了させる（リソースリーク防止）

### 7. `mcp/package.json` に `check` スクリプト追加

現在の `package.json` の `scripts` セクションを更新します:

```bash
cat > mcp/package.json << 'EOF'
{
  "name": "mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "会食ムキムキ君 グルメ MCP Server",
  "scripts": {
    "dev": "node src/server.ts",
    "check": "node src/check.ts"
  },
  "engines": {
    "node": ">=24"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0"
  }
}
EOF
```

---

## 動作確認

```bash
docker compose run --rm mcp npm run check
```

期待する出力（店舗名は日々変わります）:

```
> mcp@0.1.0 check
> node src/check.ts

{"ts":"...","source":"mcp","phase":"server_started","desc":"MCPサーバー起動（stdio）","transport":"stdio"}
[check] connected to MCP server
{"ts":"...","source":"mcp","phase":"list_tools","desc":"ツール一覧をクライアントへ応答","count":1}
[check] tools: [ 'search_shops' ]
{"ts":"...","source":"mcp","phase":"list_resources","desc":"リソース一覧をクライアントへ応答","count":1}
[check] resources: [ 'file:///app/resources/gourmet-api.html' ]
{"ts":"...","source":"mcp","phase":"read_resource_received","desc":"リソース読み取り要求を受信","uri":"file:///app/resources/gourmet-api.html"}
{"ts":"...","source":"mcp","phase":"read_resource_done","desc":"リソース読み取りが正常完了","uri":"file:///app/resources/gourmet-api.html","bytes":132671}
[check] read resource file:///app/resources/gourmet-api.html: 132671 bytes
[check] calling search_shops (keyword="鶏", count=3)...
{"ts":"...","source":"mcp","phase":"call_tool_received","desc":"ツール呼び出しを受信","name":"search_shops","args":{"keyword":"鶏","count":3}}
{"ts":"...","source":"mcp","phase":"gourmet_api_request","desc":"グルメ検索API へリクエスト送信","url":"<API URL>[REDACTED]&format=json&service_area=SA98&count=3&keyword=%E9%B6%8F"}
{"ts":"...","source":"mcp","phase":"gourmet_api_response","desc":"グルメ検索API からレスポンス受信","results_available":46,"results_returned":"3"}
{"ts":"...","source":"mcp","phase":"call_tool_done","desc":"ツール実行が正常完了","name":"search_shops","count":3}
[check] got 3 shops:
  - とりいちず 与那原店 (居酒屋) / 通常2000円・宴会3000円・チャージ料金484円(税込)
  - とりいちず 沖縄胡屋店 (居酒屋) / 通常2000円・宴会3000円
  - 地鶏備長とり幻 (和食) / 4000-5000円
```

3件の店舗名が見えれば **Step 3 完了** です。

---

## ログ観察タブ（Terminal B）

### このStepから増えるログ phase

Step 2 の `server_started` / `call_tool_unknown` / `fatal` に加えて:

| phase | 出るタイミング | 何が分かる |
|---|---|---|
| `list_tools` | `ListTools` リクエスト受信時 | ツール一覧が何件返ったか |
| `call_tool_received` | `CallTool` リクエスト受信時 | ツール名と引数 |
| `gourmet_api_request` | グルメ検索API リクエスト送信直前 | URL（APIキーは `[REDACTED]`） |
| `gourmet_api_response` | グルメ検索API レスポンス受信直後 | 全件数と返却件数 |
| `call_tool_done` | ツール実行が成功したとき | 返却件数 |
| `call_tool_error` | ツール実行中に例外 | エラーメッセージ |

### Terminal B で実行するコマンド

別タブを開いて:

**生JSON版**:

```bash
cd aiagent-handson/
tail -f logs/mcp-*.jsonl
```

**jq 版（読みやすい、要 `brew install jq`）**:

```bash
tail -f logs/mcp-*.jsonl | jq -r '"\(.ts) [\(.phase)] \(. | del(.ts, .source, .phase) | tostring)"'
```

### 観察ポイント

Terminal A で `docker compose run --rm mcp npm run check` を実行した瞬間、Terminal B に以下のような時系列が流れます:

```
... [server_started] {"transport":"stdio"}
... [list_tools] {"count":1}
... [call_tool_received] {"name":"search_shops","args":{"keyword":"鶏","count":3}}
... [gourmet_api_request] {"url":"...[REDACTED]..."}
... [gourmet_api_response] {"results_available":46,"results_returned":"3"}
... [call_tool_done] {"name":"search_shops","count":3}
```

**勘どころ**:
- `gourmet_api_response` の `results_available` が **0** だとエリアコード疑い（Step 3 開発時の SA49→SA98 誤りはこれで発見した）
- Terminal A には `check.ts` 自体の出力（`[check] got N shops` など）、Terminal B には MCP 側の詳細な phase が出る → **役割分担ができている**

---

## トラブルシュート

| 症状                                                  | 原因候補                                                     | 対処                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| `results_available= 0` で 0件                         | エリアコード違い or 極端に絞りすぎ                           | `service_area=SA98`（沖縄）を確認。キーワードを外して試す |
| `GOURMET_API_KEY is not set`                        | `.env` に未設定 or compose再起動忘れ                         | `.env` を確認し、`docker compose run` を再実行            |
| `グルメ検索API error 2000: そんなAPIキーは知りません` | 無効なキー                                                   | グルメ管理画面でキーを再発行                           |
| `Cannot find module './tools.ts'`                     | `tsconfig.json` に `allowImportingTsExtensions: true` が無い | Step 1 の tsconfig を確認                                 |
| サーバーが起動しない                                  | `.env` が読み込まれていない                                  | `docker-compose.yml` に `env_file: .env` があるか確認     |

---

## このStepでの勘どころ

1. **エリアコードは必ずマスターAPIで確認する**
   - 推測や古い記憶で書いた値は高確率で古い／違う
   - グルメの場合 `（APIマスター）` が一覧を返す
   - 沖縄 = SA98（`SA49` と勘違いしやすいので注意）

2. **`results_available` を必ずログる**
   - `results_available=0` と `results_available=1760 returned=3` は見た目が似ているが原因が違う
   - 0件時に「API疎通失敗？パラメータ誤り？」を切り分けるための最重要シグナル

3. **Tool Description は3ブロック構成で書く**
   - 【使うタイミング】= LLMがいつ呼ぶかの判断材料
   - 【返却内容】= 次の処理にどう使えるかの情報
   - 【制約】= LLMが思考から外すべき選択肢
   - 曖昧な1行description だと LLM の選択精度が落ちる（Step8の引き算実験Aで実測予定）

4. **MCPサーバーとクライアントは同一プロセスで完結しない**
   - クライアントがサーバーを **spawn** する（stdioモードの場合）
   - `command`, `args`, `env` を介して環境を継承させる
   - Step 6 で Agent が同じパターンで MCP サーバーを spawn する

5. **外部APIへのアクセスログは必ず REDACT**
   - `url.replace(apiKey, "[REDACTED]")` のような単純置換で十分
   - キー長が十分ランダム（32文字以上）なら偶然一致の心配は無視できる

6. **MCP には「ツール」と「リソース」の2つの公開口がある**
   - ツール (`tools/*`): LLM が**呼び出す**もの。副作用を伴う API やデータ取得アクション
   - リソース (`resources/*`): LLM が**参照する**もの。ドキュメント・仕様書・定数マスタ等
   - `capabilities: { tools: {}, resources: {} }` で両方を宣言して初めて、クライアントが使えるようになる
   - 本 Step では グルメ検索API リファレンス HTML をリソースとして公開し、Step 10（アブレーション実験B）で **リソースを LLM に渡すと引数精度が上がるか**を実測する素材にする

---

## コミット

### 実装コミット

```bash
git add mcp/package.json \
        mcp/src/server.ts \
        mcp/src/gourmet.ts \
        mcp/src/tools.ts \
        mcp/src/check.ts

git commit -m "feat: Step3 グルメラッパと search_shops ツール追加"
```

### 手順書コミット

```bash
git add procedure-docs/step-03-search-shops.md \
        dev-plan-v2.md

git commit -m "docs: Step3 手順書追加"
```

---

## やってみる ✨

### 今できるようになったこと

- MCPツール `search_shops` から **グルメ検索API で沖縄の店舗を実際に検索できる**
- ツール呼び出し → 外部API通信 → 結果返却の **全フローがログで追える**
- API キーは `[REDACTED]` で保護されながら、中身は見える

### 1分でできる確認

**Terminal B**（別タブ）:

```bash
cd aiagent-handson/
# 生JSON でも見やすい
tail -F logs/mcp-*.jsonl 2>/dev/null
# jq が入っていれば整形版
# tail -F logs/mcp-*.jsonl 2>/dev/null | jq -r '"\(.ts) [\(.phase)] \(. | del(.ts, .source, .phase) | tostring)"'
```

**Terminal A**:

```bash
docker compose run --rm mcp npm run check
```

### 見えるはずのもの

Terminal A 側: 沖縄の店舗 **3件**（例: 「とりいちず 与那原店」など）と平均予算。

Terminal B 側: **6 phases が時系列で流れる**:

```
server_started → list_tools → call_tool_received
→ gourmet_api_request → gourmet_api_response → call_tool_done
```

1つの `check` 実行で MCP が外部APIを叩き、結果が返ってくる**全プロセス**を自分の目で追えます。
これが Step 4 以降で Agent と組み合わせたときの**土台の動き**です。

---

## 次のStep

→ [Step 4: get_shop_detail ツール追加](./step-04-get-shop-detail.md)
