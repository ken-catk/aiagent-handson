# Step 4 時点の構成図

Step 4 完了時点での構成。Step 3 からの **追加分は ★new** で示す。
骨格 (`check.ts` → `server.ts` → `gourmet.ts` → グルメ検索API、`logger.ts` 経由の観測性）
は Step 3 と同じで、**ツールと呼び出し分岐が 1 つ増えた** だけ。

## 構成図

```mermaid
flowchart LR
    USER["開発者<br/>docker compose run"]

    subgraph Host["ホスト（リポジトリルート）"]
        ENV[".env"]
        LOGS["logs/mcp-*.jsonl"]
        RESOURCE["mcp/resources/<br/>gourmet-api.html"]
    end

    subgraph MCPC["mcp コンテナ（Node 24）"]
        CHECK["check.ts<br/>search → detail 連鎖 ★new"]
        SERVER["server.ts<br/>ListTools / CallTool<br/>ListResources / ReadResource"]
        T1["tools.ts::SEARCH_SHOPS_TOOL"]
        T2["tools.ts::GET_SHOP_DETAIL_TOOL ★new"]
        G1["gourmet.ts::searchShops"]
        G2["gourmet.ts::getShopDetail ★new"]
        LOGGER["logger.ts"]
    end

    EXT["グルメ検索API"]

    USER --> CHECK
    CHECK -->|spawn / stdio| SERVER
    SERVER -->|ツール定義| T1
    SERVER -->|ツール定義| T2
    SERVER -->|search_shops 分岐| G1
    SERVER -->|get_shop_detail 分岐 ★new| G2
    SERVER -->|log| LOGGER
    SERVER -->|readFile| RESOURCE
    G1 -->|fetch| EXT
    G2 -->|fetch| EXT
    G1 -->|log| LOGGER
    G2 -->|log purpose=detail| LOGGER
    LOGGER -->|append| LOGS
    LOGGER -->|console.error| USER
    ENV -.->|env_file| MCPC
```

## Step 3 からの差分

| 追加/変更点 | ファイル | 役割 |
|---|---|---|
| `GET_SHOP_DETAIL_TOOL` | `mcp/src/tools.ts` | 店舗 ID を必須入力にした 2 つめのツール定義 |
| `getShopDetail(id)` | `mcp/src/gourmet.ts` | グルメ検索API を `id` 指定で叩き単一店舗を取る |
| `get_shop_detail` 分岐 | `mcp/src/server.ts` | CallTool ハンドラに 2 つめの分岐を追加（Shop not found は `isError: true`） |
| `list_tools` の count | `mcp/src/server.ts` | 1 → 2 に更新 |
| search → detail の連鎖 | `mcp/src/check.ts` | search 結果の先頭 `shop.id` を拾って detail を呼ぶ |

## 押さえておきたい 2 点

1. **ツール追加はパターン化できる**。
   新しいツールを増やすときは「`gourmet.ts` に関数 → `tools.ts` に定義 → `server.ts` に分岐」
   の 3 点だけ触る。他のレイヤ（check.ts, logger.ts, resources, docker-compose）はそのまま。
2. **`purpose` ログタグで同じ `gourmet_api_request` phase を区別する**。
   search と detail は同じ phase 名で記録されるが、`getShopDetail` 側は
   `purpose: "detail"` を付けておくので、後の監視や集計で種別を分けられる。
