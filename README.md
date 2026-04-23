# aiagent-handson

AI Agent × MCP ハンズオン用リポジトリ。

## 環境構築

以下のツールをインストールし、バージョンが返ることを確認してください。

### 1. Docker Desktop

[Docker Desktop](https://www.docker.com/products/docker-desktop/) をインストールし、起動しておきます。

```bash
docker --version           # 例: Docker version 24.x 以上
docker compose version     # 例: Docker Compose version v2.x
```

### 2. mise（Node のバージョン管理）

```bash
# macOS（Homebrew）
brew install mise

# それ以外
curl https://mise.run | sh
```

```bash
mise --version
```

### 3. Node.js 24.15.0

mise 経由でインストールします。

```bash
mise use -g node@24.15.0
node --version             # v24.15.0
```

---

すべてバージョンが返れば環境構築は完了です。
次は [Step 0: 全体像と進め方](./docs/step-00-overview.md) へ進んでください。
