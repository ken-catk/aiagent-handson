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
