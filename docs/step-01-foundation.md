# Step 1: 土台作成 — Docker Compose + パッケージ骨組み

> 上から順に読んで、コマンド・ファイル内容をそのままコピペすれば完了します。
> 全体像をまず見たい方は **[Step 0: 全体像と進め方](./step-00-overview.md)** を先にどうぞ。

## このStepで作るもの

### Step 1 完了時点のディレクトリ構造

```text
aiagent-handson/
├── .env                      既存（APIキー、gitignore）
├── .env.example              既存
├── .gitignore                ← 新規（このStep）
├── docker-compose.yml        ← 新規（このStep）
├── logs/                     ← 新規（空、gitignore）
├── aiagent/
│   ├── Dockerfile            ← 新規（このStep）
│   ├── package.json          ← 新規（このStep）
│   └── tsconfig.json         ← 新規（このStep）
└── mcp/
    ├── Dockerfile            ← 新規（このStep）
    ├── package.json          ← 新規（このStep）
    ├── tsconfig.json         ← 新規（このStep）
    └── resources/            既存
        └── gourmet-api.html
```

### 作成ファイル一覧

- `mcp/`（MCPサーバー用パッケージの骨組み）
- `aiagent/`（AIエージェント用パッケージの骨組み）
- `docker-compose.yml`（両サービス起動の定義）
- `.gitignore`
- `logs/`（ログ出力先）

この段階では**ソースコードは書きません**。「Docker で node コンテナが起動する」ところまで。

## 完了条件

- `docker compose build` が成功する
- `docker compose run --rm mcp node --version` が `v24.15.0` を返す
- `docker compose run --rm agent node --version` が `v24.15.0` を返す

## 所要時間

約 15 分

## 前提条件

- macOS / Linux
- Docker Desktop インストール済み（`docker --version` で応答がある）
- mise インストール済み（Node バージョン切替用）
- リポジトリルートに `.mise.toml` が既に存在し、`node = "24.15.0"` が指定されている
- `.env` と `.env.example` が既に存在する（APIキー投入済み）

未整備の場合はこのStepを始める前に整えてください。

---

## 手順

### 1. ディレクトリに移動

```bash
cd aiagent-handson/
```

以降のコマンドはすべてこのディレクトリを基点に実行します。

### 2. サブディレクトリを作成

```bash
mkdir -p mcp aiagent logs
```

### 3. `.gitignore` を作成

```bash
cat > .gitignore << 'EOF'
# ログ
logs/
*.log

# 依存関係
**/node_modules/

# ビルド成果物
**/dist/
**/*.tsbuildinfo

# 環境変数（ルート .gitignore でも除外されているが、冪等性のため）
.env
.env.local

# OS
.DS_Store
EOF
```

### 4. `mcp/package.json` を作成

```bash
cat > mcp/package.json << 'EOF'
{
  "name": "mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "会食ムキムキ君 グルメ MCP Server",
  "scripts": {
    "dev": "node src/server.ts"
  },
  "engines": {
    "node": ">=24"
  }
}
EOF
```

**ポイント**:
- `"type": "module"` — ESM を既定に。MCP SDK / OpenAI SDK が ESM 前提なので統一
- `"engines.node": ">=24"` — Node 24 を要求
- `scripts.dev` で後続 Step で `server.ts` を指す

### 5. `mcp/tsconfig.json` を作成

```bash
cat > mcp/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
EOF
```

**ポイント**:
- `noEmit: true` — Node 24 が `.ts` 直接実行できるのでビルド成果物は不要
- `allowImportingTsExtensions: true` — `import './foo.ts'` と拡張子付きで書ける（Node 24のESM挙動と整合）

### 6. `mcp/Dockerfile` を作成

```bash
cat > mcp/Dockerfile << 'EOF'
FROM node:24-bookworm-slim

WORKDIR /app

# 依存は先にインストールしてキャッシュ効かせる
COPY package.json ./
RUN npm install --omit=dev 2>/dev/null || true

# ソースはcompose側でボリュームマウント想定
# Step 1 段階ではまだ src/ が存在しないためここでは何もコピーしない

CMD ["node", "--version"]
EOF
```

**ポイント**:
- `node:24-bookworm-slim` — Debian Bookworm ベースの軽量イメージ
- Step 1 段階では `src/` をCOPYしない（まだ空なので）。次Step以降は volume マウントで開発する
- `CMD ["node", "--version"]` は**仮の起動コマンド**。Step 2 以降で差し替わる

### 7. `aiagent/package.json` を作成

```bash
cat > aiagent/package.json << 'EOF'
{
  "name": "aiagent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "会食ムキムキ君 AI Agent",
  "scripts": {
    "dev": "node src/index.ts"
  },
  "engines": {
    "node": ">=24"
  }
}
EOF
```

### 8. `aiagent/tsconfig.json` を作成

```bash
cat > aiagent/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
EOF
```

### 9. `aiagent/Dockerfile` を作成

```bash
cat > aiagent/Dockerfile << 'EOF'
FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev 2>/dev/null || true

# ソースはcompose側でボリュームマウント想定

CMD ["node", "--version"]
EOF
```

### 10. `docker-compose.yml` を作成

```bash
cat > docker-compose.yml << 'EOF'
services:
  mcp:
    build:
      context: ./mcp
    working_dir: /app
    volumes:
      - ./mcp:/app
      - /app/node_modules
    env_file:
      - .env

  agent:
    build:
      context: ./aiagent
    working_dir: /app
    volumes:
      - ./aiagent:/app
      - /app/node_modules
      - ./logs:/app/logs
    env_file:
      - .env
    depends_on:
      - mcp
EOF
```

**ポイント**:
- `volumes: - ./mcp:/app` でホストのソースをコンテナにマウント。コード編集が即反映される
- `/app/node_modules` は**匿名ボリューム**でマスク。コンテナ内 `node_modules` がホスト側で上書きされないようにする定番パターン
- `env_file: .env` で `.env` の環境変数を全部コンテナに渡す

---

## 動作確認

### ビルド

```bash
docker compose build
```

初回は Node イメージのダウンロードで数十秒〜数分かかります。

期待する最終行:

```
Use 'docker scan' to run Snyk tests against images to find vulnerabilities and learn how to fix them
```

（エラーが出ずに `naming to docker.io/library/aiagent-and-mcp-mcp done` のようなメッセージが見えればOK）

### Node バージョン確認

```bash
docker compose run --rm mcp node --version
docker compose run --rm agent node --version
```

期待する出力:

```
v24.15.0
v24.15.0
```

両方とも `v24.15.0` が返れば **Step 1 完了** です。

---

## ログ観察タブ（準備）

このStepではまだアプリケーションコードが無いので観察対象のログは出ません。
ただし、**Step 2 以降は 2 ターミナル運用**（片方でAgent実行、片方でログ観察）を基本にします。
今のうちに **別ターミナルを開いておくクセ**を作っておくと、Step 2 から即 `tail -f` できます。

### 今 Step 1 で見えるもの

- `docker compose build` のビルドログ
- `docker compose run --rm mcp node --version` の出力（`v24.15.0`）

これは両方とも Terminal A（実行側）で完結。Terminal B の出番は Step 2 以降。

### 準備しておくこと

- エディタとは別に**2つのターミナルタブ**を開けるようにしておく
- 1つは `cd aiagent-handson/` に入った状態に
- もう1つは `logs/` を `ls` で確認できる状態に

Step 2 で `logger.ts` 経由のファイル出力が始まり、`tail -f logs/mcp-*.jsonl` が有効になります。

---

## トラブルシュート

| 症状 | 原因候補 | 対処 |
|---|---|---|
| `docker: command not found` | Docker Desktop 未起動 | Docker Desktop を起動 |
| `no matching manifest for linux/arm64` | Apple Silicon で稀に発生 | `FROM node:24-bookworm-slim` を `FROM --platform=linux/arm64 node:24-bookworm-slim` に一時変更 |
| `docker compose build` が `.env not found` | `.env` 未作成 | `.env.example` をコピーして API キーを投入 |
| `v24.15.0` ではなく別のバージョンが出る | Dockerfile の `FROM` 行が違う | `mcp/Dockerfile` と `aiagent/Dockerfile` の `FROM node:24-bookworm-slim` を確認 |

---

## このStepでの勘どころ

1. **src/ を作らないのがポイント**
   - 「何かが動く最小単位」を確認する段階
   - コードは Step 2 から入れる
   - 何段階も前倒しで書くと、失敗時の切り分けが難しくなる

2. **Dockerfile と docker-compose の役割分担**
   - Dockerfile = コンテナ「イメージ」の定義（FROM と依存インストール）
   - docker-compose = 「起動時」の設定（volume / env / depends_on）
   - Step 1 では両方とも最小限。後続で肉付けする

3. **volume と匿名ボリュームの組み合わせ**
   - `./mcp:/app`（ホストのコードを即反映）
   - `/app/node_modules`（コンテナ内を守る）
   - この2行セットは Node コンテナ開発の定石

4. **TypeScript をビルドしないという選択**
   - `noEmit: true` でビルド成果物を作らない
   - Node 24 の `.ts` 直接実行を活用
   - 学習用に「ソースと実行がそのまま繋がる」状態を保つ

---

## コミット

```bash
git add .gitignore \
        docker-compose.yml \
        mcp/Dockerfile \
        mcp/package.json \
        mcp/tsconfig.json \
        aiagent/Dockerfile \
        aiagent/package.json \
        aiagent/tsconfig.json

git commit -m "feat: Step1 土台作成 - Docker Compose + package/tsconfig 骨組み"
```

---

## やってみる ✨

### 今できるようになったこと

- Docker コンテナで **Node 24.15.0** が動く
- `mcp` / `aiagent` の 2 サービスが起動できる

### 30秒でできる確認

```bash
docker compose run --rm mcp node --version
docker compose run --rm agent node --version
```

両方とも `v24.15.0` が返れば **今日の土台は完成**。
Step 2 からこのコンテナの中で MCP サーバーが立ち上がります。

---

## 次のStep

→ [Step 2: MCPサーバー最小起動](./step-02-mcp-minimal.md)（次Step完了後に作成）
