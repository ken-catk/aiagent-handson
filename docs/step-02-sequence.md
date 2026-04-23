# Step 2: MCP 最小起動のシーケンス

Step 2 で作った MCP サーバーが「呼ばれたときに実際に何が起きるか」を、
最小の登場人物だけでまとめた図。細部は本体手順書 [`step-02-mcp-minimal.md`](./step-02-mcp-minimal.md) を参照。

## 登場パーツ

- **`mcp/src/server.ts`** — `Server` インスタンス + `ListTools` / `CallTool` の 2 ハンドラ
- **`mcp/src/logger.ts`** — JSON Lines ロガー。ファイル (`logs/mcp-*.jsonl`) と stderr に二重出力し、
  シークレットを自動で `[REDACTED]` に置換する
- **`StdioServerTransport`** — MCP SDK 提供の stdio 経由 JSON-RPC トランスポート

## シーケンス図

```mermaid
sequenceDiagram
    autonumber
    participant C as MCP クライアント
    participant S as server.ts
    participant T as StdioServerTransport
    participant L as logger.ts
    participant F as logs/mcp-*.jsonl
    participant E as stderr

    Note over S,T: 起動
    S->>T: server.connect (stdio)
    S->>L: log server_started
    L->>F: JSON を 1 行 append
    L->>E: 同じ JSON を stderr 出力

    Note over C,S: ツール一覧
    C->>T: ListTools リクエスト
    T->>S: ハンドラを呼ぶ
    S->>L: log list_tools
    L->>F: append
    L->>E: write
    S-->>C: tools は空配列

    Note over C,S: ツール呼び出し（Step 2 は常に未実装）
    C->>T: CallTool リクエスト
    T->>S: ハンドラを呼ぶ
    S->>L: log call_tool_unknown
    L->>F: append
    L->>E: write
    S-->>C: Not Implemented を isError で返す
```

## 押さえておきたい 3 点

1. **stdout は MCP プロトコル専用**。サーバー側のログは必ず **stderr + ファイル**に書く
   （stdout に書くとプロトコルが壊れる）。`logger.ts` が `console.error` +
   `appendFileSync` の両方を呼ぶのはこのため。
2. **ツールは空でも MCP として成立する**。`ListTools` が空配列を返すのも仕様上正しい応答。
   Step 3 以降でここに `search_shops` などを足していく。
3. **業務エラーは `isError: true` で返す**（throw しない）。throw すると MCP クライアント側で
   通信エラー扱いになり、業務エラーと区別できなくなる。Step 2 の `Not Implemented` 応答は
   「ツールは届いているが中身がまだ無い」を表現している。
