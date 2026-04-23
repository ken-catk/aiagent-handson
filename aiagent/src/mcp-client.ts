/**
 * MCP クライアント接続ヘルパ
 *
 * Agent コンテナ内から /app/mcp/src/server.ts を子プロセスとして spawn し、
 * stdio で MCPサーバーに接続する。
 *
 * - MCP ソースは docker-compose の volume で /app/mcp:ro にマウント
 * - /app/mcp/src/server.ts から `@modelcontextprotocol/sdk` を import すると
 *   Node のESM解決が /app/mcp/node_modules → /app/node_modules と辿り
 *   agent の node_modules にインストール済みの SDK を発見する
 *   （/app 配下に置くことがポイント。NODE_PATH は ESM では効かない）
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { log } from "./logger.ts";

export async function connectMcpClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["/app/mcp/src/server.ts"],
    env: {
      ...(process.env as Record<string, string>),
      // MCP が グルメ検索API を呼ぶために必要
      GOURMET_API_KEY: process.env.GOURMET_API_KEY ?? "",
      // MCP のログも logs/ に書かれるよう LOG_DIR を明示
      LOG_DIR: process.env.LOG_DIR ?? "/app/logs",
    },
  });

  const client = new Client(
    { name: "kaishoku-mukimuki-agent", version: "0.1.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
  log("mcp_connected", {});

  return client;
}
