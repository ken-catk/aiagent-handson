import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * search_shops ツール定義
 *
 * Tool Descriptionは「LLMとの契約書」。
 * 使うタイミング・返却内容・制約を曖昧語なく明記する。
 */
export const SEARCH_SHOPS_TOOL: Tool = {
  name: "search_shops",
  description: `沖縄エリアのレストラン・居酒屋・飲食店を、キーワードや予算で検索する。

【使うタイミング】
- ユーザーが会食候補の店を探している時
- 店舗一覧を元にフィルタリング判断する材料を揃えたい時

【返却内容】
- 店舗の配列（id, 店舗名, ジャンル, キャッチ, 住所, URL, 平均予算）

【制約】
- 検索エリアは沖縄全体（service_area=SA98）固定
- 最大返却件数は count パラメータ（既定10、上限30）
- count を超える値を指定しても内部で30件に丸める`,
  inputSchema: {
    type: "object",
    properties: {
      keyword: {
        type: "string",
        description: "検索キーワード。例: 「鶏」「刺身」「居酒屋」",
      },
      budget: {
        type: "string",
        description:
          "グルメ 予算コード。例: 「B002」=2001〜3000円, 「B003」=3001〜4000円",
      },
      count: {
        type: "number",
        description: "返却件数（1〜30）。既定は10。",
        minimum: 1,
        maximum: 30,
      },
    },
  },
};
