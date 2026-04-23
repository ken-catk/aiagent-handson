FROM node:24-bookworm-slim

WORKDIR /app

# 依存は先にインストールしてキャッシュ効かせる
COPY package.json ./
RUN npm install --omit=dev 2>/dev/null || true

# ソースはcompose側でボリュームマウント想定
# Step 1 段階ではまだ src/ が存在しないためここでは何もコピーしない

CMD ["node", "--version"]
