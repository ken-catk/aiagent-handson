# Step 8: 連携テスト（正常系）

> 上から順に読んで、コマンド・ファイル内容をそのままコピペすれば完了します。
> **ハンズオンの最終章**。Step 1-7 で組み上げた全体が再現可能に動くことを自動テストで保証します。
> 時間短縮のため**正常系のみ**。異常系は発展編として後送り。

## このStepで作るもの

### Step 8 完了時点のディレクトリ構造

```text
learn-aiagent/aiagent-and-mcp/
├── .env
├── .env.example
├── .gitignore
├── docker-compose.yml
├── logs/
├── aiagent/
│   ├── ... (Step 7 完了状態のまま)
├── mcp/
│   ├── ... (Step 4 完了状態のまま)
├── procedure-docs/
│   ├── step-00 〜 step-07 (既存)
│   └── step-08-integration-test.md
└── tests/                          ← 新規（このStep）
    └── run-normal.sh               ← 新規（このStep、正常系テスト）
```

### 作成ファイル

- `tests/run-normal.sh` — 正常系の end-to-end テスト（bash シェルスクリプト）

## 完了条件

- `./tests/run-normal.sh` を実行すると **`PASS: 全チェック通過`** が出る
- exit code が 0

## 所要時間

約 20 分

## 前提条件

- Step 7 完了済み（会食ムキムキ君として動作している）
- `docker compose build` 済み
- `.env` に有効な API キー

---

## 手順

### 1. ディレクトリに移動

```bash
cd learn-aiagent/aiagent-and-mcp
```

### 2. `tests/` ディレクトリを作成

```bash
mkdir -p tests
```

### 3. `tests/run-normal.sh` を作成

```bash
cat > tests/run-normal.sh << 'EOF'
#!/usr/bin/env bash
#
# 正常系 連携テスト（Step 8）
#
# 実行方法:
#   cd learn-aiagent/aiagent-and-mcp
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

# 実行ディレクトリを aiagent-and-mcp 直下に揃える
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
EOF
```

**ポイント**:
- 検証観点を **4つに分ける**:
  1. 実行成功（exit 0）
  2. 期待 phase の網羅（ログ8種）
  3. ビジネスロジック（filter が 1件以上返した）
  4. 応答実体（100文字以上）
- **プロンプトは「刺身」「魚介」を含む**ことで、healthy_keywords の `high_protein` カテゴリに確実ヒット
  - LLM の引数組み立てブレに左右されない **安定テスト設計**
- `set -u` で未定義変数を検出、`rm -f` で一時ファイルクリーンアップ
- **exit code で PASS/FAIL を明示** → CI/CD や watch ループに載せやすい

### 4. 実行権限を付与

```bash
chmod +x tests/run-normal.sh
```

### 5. テスト実行

```bash
./tests/run-normal.sh
```

---

## 動作確認

期待する出力:

```
================================================================
  連携テスト（正常系）
================================================================
  プロンプト: 沖縄で会食向けに刺身や魚介が美味しい健康的なお店を教えて

[TEST 1/4] Agent 実行（docker compose run）...
  [OK] Agent が exit 0 で終了

[TEST 2/4] ログファイル確認: logs/agent-2026-04-24T...jsonl
  [OK] phase: input
  [OK] phase: mcp_connected
  [OK] phase: agent_start
  [OK] phase: tool_call
  [OK] phase: tool_result
  [OK] phase: filter_applied
  [OK] phase: agent_done
  [OK] phase: final

[TEST 3/4] フィルタ結果検証...
  [OK] filter_applied output_count=2

[TEST 4/4] 最終応答の長さ検証...
  [OK] final content_length=466

================================================================
  PASS: 全チェック通過
================================================================
```

**`PASS: 全チェック通過`** が出れば **Step 8 完了、ハンズオン全工程完走** です🎉

---

## ログ観察タブ（Terminal B）

Step 8 のテストはスクリプト内部で Agent を起動するので、Terminal B は **ログ自体の出力を眺める**形で使えます。

### Terminal B で実行するコマンド

```bash
tail -F logs/*.jsonl 2>/dev/null | jq -r '"\(.ts | .[11:19]) [\(.source)] \(.desc)"'
```

### 観察ポイント

- テスト実行中、**Step 7 で見たのと同じフロー**が流れる
- テスト成功後、その実行のログが `logs/` に **epoch証拠**として残っている
- `./tests/run-normal.sh` を複数回実行すると、**毎回新しい agent/mcp ログファイル**が増えていく（タイムスタンプ付きファイル名）

---

## 新しいプロンプトでもテストを試してみる

テストスクリプトの `PROMPT` 変数を書き換えるだけで、好きなクエリで再実行できます:

```bash
# 一時的に変えて試す（環境変数で上書きする改造は任意で）
sed -i.bak 's/刺身や魚介が美味しい/野菜が豊富な/' tests/run-normal.sh
./tests/run-normal.sh
mv tests/run-normal.sh.bak tests/run-normal.sh
```

各カテゴリ（`high_protein` / `low_fat_method` / `healthy_pitch`）の単語を試すと、`filter_applied` の `hit_categories` が変化するのが観察できます。

---

## トラブルシュート

| 症状 | 原因候補 | 対処 |
|---|---|---|
| `[FAIL] Agent が非ゼロで終了` | OpenAI/グルメ検索APIエラー、モデル名誤り | `.env` のキーとモデル名を再確認 |
| `[FAIL] phase: ... が見つかりません` | Step 7 の実装が途中で止まっている | Step 7 の動作確認を再実行 |
| `[FAIL] output_count が 0` | フィルタに引っかかる語が応答に無かった | プロンプトを変える、または healthy_keywords.json を拡張 |
| `[FAIL] content_length が 0` | LLMが何も返さなかった（稀） | 再実行、または MAX_TURNS を増やす |
| `Permission denied` | chmod 忘れ | `chmod +x tests/run-normal.sh` |

---

## このStepでの勘どころ

1. **テストは「再現可能な成功」を保証する**
   - 手動で何度も叩いて動くことを確認するより、スクリプト1本走らせるほうが確実
   - `./tests/run-normal.sh` を Ctrl+R すれば即再現できる状態がハンズオン後の資産

2. **検証観点は「ログの存在」で代替する**
   - 最終応答の内容（自然文）を文字列マッチで検証するのは脆い（LLMは毎回違う言い回し）
   - 代わりに **必須 phase の出現** と **数値フィールド（count, length）の閾値**で判定
   - これは**LLMベースシステムの実運用テストの定石**

3. **テストプロンプトは辞書と噛み合わせる**
   - LLMの引数組み立てにブレがあると、フィルタがヒットしないケースが出る
   - テストでは**辞書内の語を直接含むプロンプト**にすることで安定化
   - 本番運用ではこの逆（辞書を拡張してLLMのブレを吸収）

4. **正常系だけでも価値は大きい**
   - 時間短縮のため正常系のみ。異常系は発展編
   - とはいえ4つの観点（exit / phase / 数値 / 実体）で**実質的に全パイプラインを触っている**

5. **テスト結果を exit code で返す**
   - CI/CD に載せられる
   - watch ループ（`watch -n 60 ./tests/run-normal.sh`）で常時監視もできる
   - ハンズオン後の運用整備の入口

---

## コミット

### 実装コミット（test）

```bash
git add learn-aiagent/aiagent-and-mcp/tests/run-normal.sh

git commit -m "test: Step8 連携テスト（正常系）追加"
```

### 手順書コミット（docs）

```bash
git add learn-aiagent/aiagent-and-mcp/procedure-docs/step-08-integration-test.md \
        learn-aiagent/aiagent-and-mcp/dev-plan-v2.md

git commit -m "docs: Step8 手順書追加、全Step完走"
```

---

## やってみる ✨

### 今できるようになったこと

- **`./tests/run-normal.sh` 一発で、Step 1-7 の全パイプラインを再現検証できる**
- ハンズオン終了後も **再現可能な成功の証拠**がリポジトリに残る
- **LLMベースシステムのテスト方法**（ログと数値で判定）を体得

### 1分でできる確認

```bash
cd learn-aiagent/aiagent-and-mcp
./tests/run-normal.sh
```

`PASS: 全チェック通過` が出れば **会食ムキムキ君ハンズオン完走** 🎉

---

## 次のStep

**なし（ハンズオン完走）**

おつかれさまでした。このリポジトリは:
- PRD で業務要件を定義し
- 開発計画で8ステップに分解し
- 各ステップで1 feat + 1 docs コミットを切り
- 2ターミナル運用でログ観察しながら積み上げ
- 最後に自動テストで完走を保証

という、**AIエージェント開発の一連の流れ**を体験する教材として完成しました。

発展として興味があれば:
- 異常系テスト（APIキー誤り、モデル名誤り、不正入力）の追加
- Langfuse / OpenTelemetry 等の観測性基盤への置き換え
- Agent を AWS Bedrock AgentCore 等のリモート実行基盤へ移す
- 判定辞書の拡張（栄養価DBとの連携など）
