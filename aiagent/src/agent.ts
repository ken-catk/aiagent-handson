/**
 * Agent 制御ループ（OpenAI Responses API + MCP tool calling）
 *
 * 流れ:
 *   1. MCP に接続して tools/list を取得
 *   2. Responses API に tools を渡して初回リクエスト
 *   3. output に function_call があれば MCP で実行 → function_call_output で再推論
 *   4. tool_calls が無くなれば最終回答を返す
 *   5. MAX_TURNS 超過で例外
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { applyHealthyFilter, type GourmetShop } from "./healthy-filter.ts";
import { getModelName, getOpenAIClient } from "./llm.ts";
import { log } from "./logger.ts";
import { connectMcpClient } from "./mcp-client.ts";

// ─────────────────────────────────────────────────────────────────────
// アブレーション実験B: MCP Resource 参照削減
// ─────────────────────────────────────────────────────────────────────
// 通常モード: ./resource-loader.ts を import（リソースを読み、system prompt に注入）
// アブレーション: 下の行をコメントアウトし、./resource-loader-ablation.ts を有効化
// （元に戻すには: git checkout -- aiagent/src/agent.ts）
import { loadResourceInstructions } from "./resource-loader.ts";
// import { loadResourceInstructions } from "./resource-loader-ablation.ts";

const MAX_TURNS = 4;

const SYSTEM_PROMPT = `あなたは「会食ムキムキ君」という AI アシスタントです。
筋肉づくり・健康維持に配慮した沖縄の会食候補を提案する役割を担います。

ツール search_shops を呼ぶとき、返却結果には以下の追加フィールドが含まれます:
- hit_keywords: その店舗でヒットした健康キーワードのリスト（必ず回答に含めること）
- hit_category: 最優先カテゴリ（high_protein / low_fat_method / healthy_pitch）
- muscle_comment: 筋トレ観点コメント（必ず回答に含めること）

返却ルール:
- 各候補について、店舗名・住所・ジャンル・予算・URL を記載
- **ヒットキーワード（hit_keywords）を理由として必ず明記**
- **筋トレ観点コメント（muscle_comment）を必ず添える**
- 候補が0件の場合は「条件に一致する健康会食候補なし」と返す
- 提供された店舗情報の範囲で回答し、事実を創作しない`;

interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface ResponseFunctionCallItem {
  type: "function_call";
  name: string;
  call_id: string;
  arguments: string;
}

function isFunctionCallItem(item: unknown): item is ResponseFunctionCallItem {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as { type?: unknown }).type === "function_call"
  );
}

function toOpenAITool(mcpTool: McpTool): Record<string, unknown> {
  return {
    type: "function",
    name: mcpTool.name,
    description: mcpTool.description ?? "",
    parameters: mcpTool.inputSchema,
  };
}

function extractText(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (c: unknown): c is { type: "text"; text: string } =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: unknown }).type === "text" &&
        typeof (c as { text?: unknown }).text === "string",
    )
    .map((c) => c.text)
    .join("\n");
}

function safeParseArgs(s: string | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function runAgent(userInput: string): Promise<string> {
  const client = getOpenAIClient();
  const model = getModelName();
  const mcp: Client = await connectMcpClient();

  try {
    const toolsList = await mcp.listTools();
    const tools = toolsList.tools.map((t) =>
      toOpenAITool({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      }),
    );
    log("agent_start", {
      tool_names: toolsList.tools.map((t) => t.name),
    });

    // アブレーション実験B: import を resource-loader-ablation.ts に切替えるとスキップ版が走る
    const referenceBlock = await loadResourceInstructions(mcp);
    const instructions = referenceBlock
      ? `${SYSTEM_PROMPT}\n\n${referenceBlock}`
      : SYSTEM_PROMPT;

    log("llm_request", { turn: 1, model, input_length: userInput.length });
    let response = await client.responses.create({
      model,
      instructions,
      input: userInput,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: tools as any,
    });
    log("llm_response", {
      turn: 1,
      response_id: response.id,
      output_kinds: response.output.map((o) => o.type),
    });

    for (let turn = 1; turn <= MAX_TURNS; turn += 1) {
      const toolCalls = response.output.filter(isFunctionCallItem);

      if (toolCalls.length === 0) {
        const finalText = response.output_text ?? "";
        log("agent_done", { turns: turn, content_length: finalText.length });
        return finalText;
      }

      const toolOutputs: Array<{
        type: "function_call_output";
        call_id: string;
        output: string;
      }> = [];

      for (const call of toolCalls) {
        const args = safeParseArgs(call.arguments);
        log("tool_call", {
          turn,
          name: call.name,
          args,
          call_id: call.call_id,
        });

        const toolResult = await mcp.callTool({
          name: call.name,
          arguments: args,
        });

        const resultText = extractText(toolResult);
        const isError = (toolResult as { isError?: unknown }).isError === true;

        log("tool_result", {
          turn,
          name: call.name,
          call_id: call.call_id,
          isError,
          preview: resultText.slice(0, 200),
        });

        // search_shops の結果には健康判定フィルタを適用する（決定的ロジック）
        let finalOutput = resultText;
        if (call.name === "search_shops" && !isError) {
          try {
            const shops = JSON.parse(resultText) as GourmetShop[];
            if (Array.isArray(shops)) {
              const filtered = applyHealthyFilter(shops, 5);
              finalOutput = JSON.stringify(filtered, null, 2);
              log("filter_applied", {
                input_count: shops.length,
                output_count: filtered.length,
                hit_categories: filtered.map((s) => s.hit_category),
              });
            }
          } catch (e) {
            log("filter_skipped", {
              reason: e instanceof Error ? e.message : String(e),
            });
          }
        }

        toolOutputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: finalOutput,
        });
      }

      log("llm_request", {
        turn: turn + 1,
        tool_outputs: toolOutputs.length,
      });
      response = await client.responses.create({
        model,
        previous_response_id: response.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input: toolOutputs as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: tools as any,
      });
      log("llm_response", {
        turn: turn + 1,
        response_id: response.id,
        output_kinds: response.output.map((o) => o.type),
      });
    }

    throw new Error(`Max turns (${MAX_TURNS}) exceeded`);
  } finally {
    await mcp.close();
  }
}
