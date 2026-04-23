/**
 * Agent CLI 入口
 *
 * 使い方:
 *   docker compose run --rm agent npm run dev -- "<プロンプト>"
 *
 * Step 5: LLM との1往復のみ。ツール呼び出しは Step 6 で追加。
 */

import { callLLM } from "./llm.ts";
import { log } from "./logger.ts";

async function main() {
  const userInput = process.argv.slice(2).join(" ").trim();
  if (!userInput) {
    console.error('Usage: npm run dev -- "<prompt>"');
    process.exit(1);
  }

  log("input", { prompt: userInput });

  try {
    const answer = await callLLM(userInput);
    console.log(answer);
    log("final", { content_length: answer.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", { phase: "main", message });
    console.error("[agent] error:", message);
    process.exit(1);
  }
}

main();
