# ---- Build the web app and compile the server ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Toolchain in case better-sqlite3 has to compile from source.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Runtime: Node 22 (also the JS runtime yt-dlp needs for YouTube) + ffmpeg + yt-dlp ----
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/*
# yt-dlp lives in a venv owned by the app user so "Update yt-dlp" in Settings works without root.
RUN python3 -m venv /opt/ytdlp \
  && /opt/ytdlp/bin/pip install --no-cache-dir -U pip "yt-dlp[default]" \
  && chown -R node:node /opt/ytdlp

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /data /library && chown node:node /data /library

ENV NODE_ENV=production \
    PORT=7070 \
    TUNO_ROOT=/app/server \
    TUNO_DATA=/data \
    TUNO_LIBRARY=/library \
    TUNO_WEB=/app/web/dist \
    YTDLP_PYTHON=/opt/ytdlp/bin/python \
    YTDLP_JS_RUNTIME=node

USER node
EXPOSE 7070
VOLUME ["/data", "/library"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:7070/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
