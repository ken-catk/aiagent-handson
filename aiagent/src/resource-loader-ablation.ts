/**
 * MCP Resource 読み込みモジュール（アブレーション版）
 *
 * アブレーション実験B: MCP Resource を一切読まずに空文字列を返す。
 * これにより system prompt に API リファレンスが注入されない状態を作る。
 *
 * 使い方: agent.ts の import を `./resource-loader.ts` からこちらに切替える
 * （元に戻すには: git checkout -- aiagent/src/agent.ts）
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { log } from "./logger.ts";

/**
 * 常に空文字列を返す（アブレーション版）。
 * MCP への通信も行わない（アブレーション条件として明確にするため）。
 */
export async function loadResourceInstructions(_mcp: Client): Promise<string> {
  log("resources_skipped", {
    reason: "resource-loader-ablation.ts imported",
  });
  return "";
}
