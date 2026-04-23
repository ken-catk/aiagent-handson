/**
 * MCP 側ログ出力
 *
 * - logs/mcp-<timestamp>.jsonl に1行1JSONで追記
 * - 同時に stderr にも同じJSON行を出す（開発時の即時確認用）
 * - APIキー・トークン系のフィールドは [REDACTED] に置換
 * - phase 名から日本語の短い説明を `desc` フィールドに自動付与
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const LOG_DIR = process.env.LOG_DIR ?? "/app/logs";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const LOG_FILE = `${LOG_DIR}/mcp-${stamp}.jsonl`;

// phase 名 → 日本語の短い説明。未登録 phase は desc が空文字列になる
const PHASE_DESC: Record<string, string> = {
  server_started: "MCPサーバー起動（stdio）",
  list_tools: "ツール一覧をクライアントへ応答",
  call_tool_received: "ツール呼び出しを受信",
  call_tool_done: "ツール実行が正常完了",
  call_tool_error: "ツール実行中にエラー",
  call_tool_unknown: "未知のツール名が指定された",
  gourmet_api_request: "グルメ検索API へリクエスト送信",
  gourmet_api_response: "グルメ検索API からレスポンス受信",
  list_resources: "リソース一覧をクライアントへ応答",
  read_resource_received: "リソース読み取り要求を受信",
  read_resource_done: "リソース読み取りが正常完了",
  read_resource_error: "リソース読み取り中にエラー",
  fatal: "MCPサーバーで致命的エラー",
};

let initialized = false;
function ensureInit(): void {
  if (initialized) return;
  mkdirSync(dirname(LOG_FILE), { recursive: true });
  initialized = true;
}

const REDACT_KEYS = /(api[_-]?key|auth[_-]?token|password|secret)/i;

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    const candidates = [
      process.env.GOURMET_API_KEY,
      process.env.MCP_AUTH_TOKEN,
      process.env.OPENAI_API_KEY,
    ].filter((v): v is string => Boolean(v && v.length > 8));
    let out = value;
    for (const secret of candidates) {
      if (out.includes(secret)) {
        out = out.split(secret).join("[REDACTED]");
      }
    }
    return out;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.test(k) ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return value;
}

export function log(phase: string, data: Record<string, unknown> = {}): void {
  ensureInit();
  const entry = {
    ts: new Date().toISOString(),
    source: "mcp",
    phase,
    desc: PHASE_DESC[phase] ?? "",
    ...(redact(data) as Record<string, unknown>),
  };
  const line = JSON.stringify(entry);
  appendFileSync(LOG_FILE, line + "\n");
  console.error(line);
}
