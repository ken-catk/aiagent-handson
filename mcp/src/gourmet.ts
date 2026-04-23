/**
 * グルメ検索API クライアント
 *
 * API URL と API キーは .env で設定する（Slack で配布される登録情報を参照）。
 */

import { log } from "./logger.ts";

function getApiUrl(): string {
  const url = process.env.GOURMET_API_URL;
  if (!url) {
    throw new Error("GOURMET_API_URL is not set");
  }
  return url;
}

// 沖縄全体のサービスエリアコード
// 値は公式のマスター API から取得した既知の定数
const OKINAWA_SERVICE_AREA = "SA98";

export interface SearchShopsParams {
  keyword?: string;
  budget?: string;
  count?: number;
}

export interface GourmetShop {
  id: string;
  name: string;
  genre: {
    name: string;
    catch: string;
  };
  catch: string;
  address: string;
  urls: {
    pc: string;
  };
  budget: {
    code: string;
    name: string;
    average: string;
  };
  [key: string]: unknown;
}

interface GourmetResponse {
  results?: {
    shop?: GourmetShop[];
    error?: Array<{ code: string; message: string }>;
    results_available?: number;
    results_returned?: string;
  };
}

export async function searchShops(
  params: SearchShopsParams,
): Promise<GourmetShop[]> {
  const apiKey = process.env.GOURMET_API_KEY;
  if (!apiKey) {
    throw new Error("GOURMET_API_KEY is not set");
  }

  const qs = new URLSearchParams({
    key: apiKey,
    format: "json",
    service_area: OKINAWA_SERVICE_AREA,
    count: String(params.count ?? 10),
  });
  if (params.keyword) qs.set("keyword", params.keyword);
  if (params.budget) qs.set("budget", params.budget);

  const url = `${getApiUrl()}?${qs.toString()}`;
  // logger が REDACT するが、念のためここでも置換しておく
  log("gourmet_api_request", { url: url.replace(apiKey, "[REDACTED]") });

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `グルメ検索API error: ${res.status} ${await res.text()}`,
    );
  }

  const data = (await res.json()) as GourmetResponse;

  if (data.results?.error && data.results.error.length > 0) {
    const err = data.results.error[0];
    throw new Error(`グルメ検索API error ${err.code}: ${err.message}`);
  }

  log("gourmet_api_response", {
    results_available: data.results?.results_available,
    results_returned: data.results?.results_returned,
  });

  return data.results?.shop ?? [];
}
