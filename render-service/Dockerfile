# Render service: markmap + Puppeteer (mind map PNG) & ffmpeg (penyiapan audio)
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# ffmpeg untuk kompresi/segmentasi audio + dependency runtime Chrome headless.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates \
      fonts-liberation \
      fonts-noto-core \
      fonts-noto-color-emoji \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libatspi2.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libglib2.0-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libx11-6 \
      libxcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_CACHE_DIR=/opt/puppeteer \
    NODE_ENV=production \
    PORT=3000 \
    AUDIO_WORK_DIR=/data/audio

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npx puppeteer browsers install chrome \
    && chmod -R a+rx /opt/puppeteer

COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /data/audio && chown -R node:node /data /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
