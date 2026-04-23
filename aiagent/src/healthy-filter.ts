/**
 * 健康会食候補判定フィルタ
 *
 * PRD §8/10 に基づく決定的ロジック:
 * - 判定対象フィールド: 店舗名 / ジャンル名・キャッチ / キャッチ
 * - カテゴリ: 高タンパク > 低脂質/調理法 > ヘルシー訴求 の優先順位
 * - 除外キーワード（食べ放題・デカ盛り・こってり）を含む店舗は除外
 * - 上位5件を返す
 * - 各候補に「筋トレ観点コメント」を決定的テンプレートで付与
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, "..", "config");

interface HealthyKeywordsConfig {
  high_protein: string[];
  low_fat_method: string[];
  healthy_pitch: string[];
}

interface ExcludedKeywordsConfig {
  excluded: string[];
}

const healthyKeywords: HealthyKeywordsConfig = JSON.parse(
  readFileSync(join(CONFIG_DIR, "healthy_keywords.json"), "utf8"),
) as HealthyKeywordsConfig;

const excludedKeywords: ExcludedKeywordsConfig = JSON.parse(
  readFileSync(join(CONFIG_DIR, "excluded_keywords.json"), "utf8"),
) as ExcludedKeywordsConfig;

const CATEGORY_SCORE: Record<string, number> = {
  high_protein: 3,
  low_fat_method: 2,
  healthy_pitch: 1,
};

export type HealthyCategory =
  | "high_protein"
  | "low_fat_method"
  | "healthy_pitch";

export interface GourmetShop {
  id?: string;
  name?: string;
  name_kana?: string;
  genre?: { name?: string; catch?: string };
  catch?: string;
  address?: string;
  urls?: { pc?: string };
  budget?: { name?: string; average?: string };
  [key: string]: unknown;
}

export interface FilteredShop extends GourmetShop {
  hit_keywords: string[];
  hit_category: HealthyCategory;
  score: number;
  muscle_comment: string;
}

function getJudgmentText(shop: GourmetShop): string {
  const parts: string[] = [];
  if (shop.name) parts.push(shop.name);
  if (shop.genre?.name) parts.push(shop.genre.name);
  if (shop.genre?.catch) parts.push(shop.genre.catch);
  if (shop.catch) parts.push(shop.catch);
  return parts.join(" ");
}

function generateMuscleComment(
  hits: string[],
  category: HealthyCategory,
): string {
  if (category === "high_protein") {
    if (
      hits.some((k) => ["鶏むね", "赤身", "タンパク質", "高たんぱく"].includes(k))
    ) {
      return "高タンパク・低脂質でバルク維持・筋肥大に向く";
    }
    if (hits.some((k) => ["魚介", "刺身"].includes(k))) {
      return "良質なタンパク質とオメガ3脂肪酸が摂れる";
    }
    return "高タンパクメニューが期待できる";
  }
  if (category === "low_fat_method") {
    return "脂質控えめな調理法で、減量期のPFCバランスに向く";
  }
  if (category === "healthy_pitch") {
    return "野菜・ヘルシー志向で、副菜とのバランスが取りやすい";
  }
  return "";
}

export function applyHealthyFilter(
  shops: GourmetShop[],
  maxCount = 5,
): FilteredShop[] {
  const results: FilteredShop[] = [];

  for (const shop of shops) {
    const text = getJudgmentText(shop);

    if (excludedKeywords.excluded.some((ex) => text.includes(ex))) {
      continue;
    }

    const hitsByCategory: Record<HealthyCategory, string[]> = {
      high_protein: [],
      low_fat_method: [],
      healthy_pitch: [],
    };
    for (const kw of healthyKeywords.high_protein) {
      if (text.includes(kw)) hitsByCategory.high_protein.push(kw);
    }
    for (const kw of healthyKeywords.low_fat_method) {
      if (text.includes(kw)) hitsByCategory.low_fat_method.push(kw);
    }
    for (const kw of healthyKeywords.healthy_pitch) {
      if (text.includes(kw)) hitsByCategory.healthy_pitch.push(kw);
    }

    const totalHits =
      hitsByCategory.high_protein.length +
      hitsByCategory.low_fat_method.length +
      hitsByCategory.healthy_pitch.length;
    if (totalHits === 0) continue;

    let hitCategory: HealthyCategory;
    if (hitsByCategory.high_protein.length > 0) {
      hitCategory = "high_protein";
    } else if (hitsByCategory.low_fat_method.length > 0) {
      hitCategory = "low_fat_method";
    } else {
      hitCategory = "healthy_pitch";
    }

    const score =
      hitsByCategory.high_protein.length * CATEGORY_SCORE.high_protein +
      hitsByCategory.low_fat_method.length * CATEGORY_SCORE.low_fat_method +
      hitsByCategory.healthy_pitch.length * CATEGORY_SCORE.healthy_pitch;

    const allHits = [
      ...hitsByCategory.high_protein,
      ...hitsByCategory.low_fat_method,
      ...hitsByCategory.healthy_pitch,
    ];

    results.push({
      ...shop,
      hit_keywords: allHits,
      hit_category: hitCategory,
      score,
      muscle_comment: generateMuscleComment(allHits, hitCategory),
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxCount);
}
