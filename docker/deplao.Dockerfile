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
    libcairo2 \
    libgtk-3-0 \
    libpango-1.0-0 \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts

COPY . .
RUN node node_modules/electron/install.js && npm run rebuild:native && npm run build:electron && npm run build:web

ENV NODE_ENV=production \
    DEPLAO_WEB=1 \
    DEPLAO_CHANNELS_ONLY=1 \
    DEPLAO_WEB_PORT=27800 \
    DEPLAO_WEB_SECURE=0

EXPOSE 27800
CMD ["sh", "-c", "rm -f /tmp/.X99-lock && Xvfb :99 -screen 0 1024x768x24 -ac >/dev/null 2>&1 & sleep 1 && DISPLAY=:99 exec ./node_modules/.bin/electron dist-electron/electron/bootstrap.js --no-sandbox --disable-gpu --disable-dev-shm-usage"]
