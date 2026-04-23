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
