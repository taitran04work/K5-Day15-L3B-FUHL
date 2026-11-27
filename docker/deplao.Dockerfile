# Build context: ./deplao (see docker-compose.yml)
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    xauth \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts

COPY . .
RUN npm run rebuild:native && npm run build:electron && npm run build:web

ENV NODE_ENV=production \
    DEPLAO_WEB=1 \
    DEPLAO_CHANNELS_ONLY=1 \
    DEPLAO_WEB_PORT=27800 \
    DEPLAO_WEB_SECURE=0

EXPOSE 27800
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1024x768x24", \
     "electron", "dist-electron/electron/bootstrap.js", \
     "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
