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
import { getModelName, getOpenAIClient } from "./llm.ts";
import { log } from "./logger.ts";
import { connectMcpClient } from "./mcp-client.ts";

const MAX_TURNS = 4;

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

    log("llm_request", { turn: 1, model, input_length: userInput.length });
    let response = await client.responses.create({
      model,
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

        toolOutputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: resultText,
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
