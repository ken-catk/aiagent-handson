FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev 2>/dev/null || true

# ソースはcompose側でボリュームマウント想定

CMD ["node", "--version"]
