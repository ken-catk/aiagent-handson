/**
 * OpenAI Responses API ラッパ
 *
 * Step 5 時点ではツール無しで「プロンプト -> テキスト応答」の単純な往復のみ。
 * Step 6 でツール定義とループを追加する。
 */

import OpenAI from "openai";
import { log } from "./logger.ts";

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

/**
 * LLM に自然言語プロンプトを投げてテキスト応答を得る。
 */
export async function callLLM(input: string): Promise<string> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const client = getClient();

  log("llm_request", { model, input_length: input.length });

  const response = await client.responses.create({
    model,
    input,
  });

  const text = response.output_text ?? "";
  log("llm_response", {
    content_length: text.length,
    content_preview: text.slice(0, 200),
  });

  return text;
}
