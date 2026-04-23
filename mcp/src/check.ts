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
    { capabilities: {} },
  );

  await client.connect(transport);
  console.log("[check] connected to MCP server");

  // tools/list
  const toolsRes = await client.listTools();
  console.log(
    "[check] tools:",
    toolsRes.tools.map((t) => t.name),
  );

  // resources/list（MCP Resource 機能の疎通確認）
  const resourcesRes = await client.listResources();
  console.log(
    "[check] resources:",
    resourcesRes.resources.map((r) => r.uri),
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
  console.log('[check] calling search_shops (keyword="鶏", count=3)...');
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
      `  - ${shop.name} (${shop.genre?.name}) / ${shop.budget?.average}`,
    );
  }

  await client.close();
}

main().catch((err) => {
  console.error("[check] fatal", err);
  process.exit(1);
});
