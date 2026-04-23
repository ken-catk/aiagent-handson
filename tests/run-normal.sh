#!/usr/bin/env bash
#
# 正常系 連携テスト（Step 8）
#
# 実行方法:
#   cd aiagent-handson/
#   ./tests/run-normal.sh
#
# 判定:
#   - Agent が exit code 0 で終了する
#   - 最新 logs/agent-*.jsonl に期待 phase が含まれる
#   - filter_applied の output_count が 1 以上
#   - final の content_length が 100 以上
#
# 全チェック通過で exit 0、いずれか失敗で exit 1。
#
set -u

# 実行ディレクトリを aiagent-handson 直下に揃える
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

# テスト安定性重視: healthy_keywords.json の high_protein カテゴリに
# 明記されている「刺身」「魚介」を含めることで、フィルタヒットを
# ほぼ確実にする（LLM の引数組立ブレに左右されないテスト設計）
PROMPT='沖縄で会食向けに刺身や魚介が美味しい健康的なお店を教えて'
OUT_FILE="/tmp/agent-out-$$.txt"

echo "================================================================"
echo "  連携テスト（正常系）"
echo "================================================================"
echo "  プロンプト: ${PROMPT}"
echo ""

# 1) Agent 実行
echo "[TEST 1/4] Agent 実行（docker compose run）..."
docker compose run --rm agent npm run dev -- "${PROMPT}" > "${OUT_FILE}" 2>&1
EXIT_CODE=$?

if [ ${EXIT_CODE} -ne 0 ]; then
  echo "  [FAIL] Agent が非ゼロで終了しました (exit=${EXIT_CODE})"
  echo "  --- Agent出力 ---"
  tail -20 "${OUT_FILE}"
  rm -f "${OUT_FILE}"
  exit 1
fi
echo "  [OK] Agent が exit 0 で終了"

# 2) 最新ログファイル特定
LATEST_LOG="$(ls -t logs/agent-*.jsonl 2>/dev/null | head -1)"
if [ -z "${LATEST_LOG}" ]; then
  echo "  [FAIL] logs/agent-*.jsonl が見つかりません"
  rm -f "${OUT_FILE}"
  exit 1
fi
echo ""
echo "[TEST 2/4] ログファイル確認: ${LATEST_LOG}"

# 3) 期待 phase がすべて含まれていることを確認
REQUIRED_PHASES=("input" "mcp_connected" "agent_start" "tool_call" "tool_result" "filter_applied" "agent_done" "final")
MISSING=0
for phase in "${REQUIRED_PHASES[@]}"; do
  if grep -q "\"phase\":\"${phase}\"" "${LATEST_LOG}"; then
    echo "  [OK] phase: ${phase}"
  else
    echo "  [FAIL] phase: ${phase} が見つかりません"
    MISSING=$((MISSING + 1))
  fi
done
if [ ${MISSING} -ne 0 ]; then
  echo "  [FAIL] 必須 phase が ${MISSING} 個欠けています"
  rm -f "${OUT_FILE}"
  exit 1
fi

# 4) filter_applied の output_count >= 1
echo ""
echo "[TEST 3/4] フィルタ結果検証..."
FILTER_LINE="$(grep '"phase":"filter_applied"' "${LATEST_LOG}" | tail -1)"
if [ -z "${FILTER_LINE}" ]; then
  echo "  [FAIL] filter_applied ログが見つかりません"
  rm -f "${OUT_FILE}"
  exit 1
fi
OUTPUT_COUNT="$(echo "${FILTER_LINE}" | grep -oE '"output_count":[0-9]+' | grep -oE '[0-9]+')"
if [ -z "${OUTPUT_COUNT}" ] || [ "${OUTPUT_COUNT}" -lt 1 ]; then
  echo "  [FAIL] output_count が ${OUTPUT_COUNT:-なし} （1以上を期待）"
  rm -f "${OUT_FILE}"
  exit 1
fi
echo "  [OK] filter_applied output_count=${OUTPUT_COUNT}"

# 5) final の content_length >= 100
echo ""
echo "[TEST 4/4] 最終応答の長さ検証..."
FINAL_LINE="$(grep '"phase":"final"' "${LATEST_LOG}" | tail -1)"
CONTENT_LENGTH="$(echo "${FINAL_LINE}" | grep -oE '"content_length":[0-9]+' | grep -oE '[0-9]+')"
if [ -z "${CONTENT_LENGTH}" ] || [ "${CONTENT_LENGTH}" -lt 100 ]; then
  echo "  [FAIL] content_length が ${CONTENT_LENGTH:-なし} （100以上を期待）"
  rm -f "${OUT_FILE}"
  exit 1
fi
echo "  [OK] final content_length=${CONTENT_LENGTH}"

rm -f "${OUT_FILE}"

echo ""
echo "================================================================"
echo "  PASS: 全チェック通過"
echo "================================================================"
exit 0
