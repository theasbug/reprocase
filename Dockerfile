# ReproCase web workbench and case runner (Linux, headless Chromium).
# Desktop control and the Electron app are Windows-only and not included.
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    REPROCASE_HEADLESS=1 \
    REPROCASE_LISTEN_HOST=0.0.0.0 \
    PLAYWRIGHT_BROWSERS_PATH=/app/.browsers

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/ai/package.json packages/ai/
COPY packages/browser/package.json packages/browser/
COPY packages/core/package.json packages/core/
RUN npm ci --ignore-scripts --include=dev \
 && npx playwright install-deps chromium \
 && rm -rf /var/lib/apt/lists/*

COPY . .
RUN node scripts/install-browser.mjs \
 && npx vite build --config apps/web/vite.config.ts \
 && mkdir -p /data \
 && chown -R node:node /data /app/.browsers

USER node
EXPOSE 4317
VOLUME ["/data"]

LABEL org.opencontainers.image.source="https://github.com/theasbug/reprocase" \
      org.opencontainers.image.description="Reproduce IDOR/BOLA findings with fresh accounts and resources" \
      org.opencontainers.image.licenses="Apache-2.0"

# The service still only accepts loopback Host/Origin values and a per-start token.
# Publish the port on loopback only: docker run -p 127.0.0.1:4317:4317 ...
ENTRYPOINT ["npx", "tsx", "apps/server/src/cli.ts"]
CMD ["demo", "--workspace", "/data", "--port", "4317"]
