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
const GOURMET_REFERENCE_PATH = path.join(
  process.cwd(),
  "resources",
  "gourmet-api.html",
);

async function main() {
  const server = new Server(
    { name: "kaishoku-mukimuki-mcp", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
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
          content: [{ type: "text", text: JSON.stringify(shops, null, 2) }],
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
      content: [{ type: "text", text: `Not Implemented: ${name}` }],
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
