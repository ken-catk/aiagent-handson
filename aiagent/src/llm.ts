/**
 * OpenAI クライアントとモデル名のヘルパー
 *
 * Step 6 以降は agent.ts が直接 client.responses.create を呼ぶため、
 * ここでは「クライアント初期化」と「モデル名取得」だけを担う薄い層にする。
 */

import OpenAI from "openai";

let _client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

export function getModelName(): string {
  return process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
}
