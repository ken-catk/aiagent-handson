import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { log } from "./logger.ts";

async function main() {
  const server = new Server(
    { name: "kaishoku-mukimuki-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // Step 2: ツールは空。Step 3 以降で search_shops / get_shop_detail を追加
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log("list_tools", { count: 0 });
    return { tools: [] };
  });

  // Step 2: CallTool は常に Not Implemented を返す
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    log("call_tool_unknown", { name: request.params.name });
    return {
      content: [
        { type: "text", text: `Not Implemented: ${request.params.name}` },
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
