# node:22-slim (Debian) instead of -alpine: sharp 0.34.x ships glibc-linked
# prebuilts that segfault on Alpine's musl unless the image installs
# python3/make/g++/vips-dev to compile from source. Slim is ~20MB heavier
# but avoids that whole class of cold-start crashes.
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --production=false
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# fonts-liberation: Helvetica/Times/Courier metric-compatible fallbacks so
# the SVG overlay's `font-family="Georgia,'Times New Roman',serif"` etc.
# actually renders (slim ships zero fonts; without these, all <text> in
# /composite-text and /banner-extend overlays comes out as box glyphs —
# observed on the LYKAN spike, 2026-05-06).
# fonts-noto-cjk: covers any Chinese product name / spec text (LYKAN
# product seed has nameZh "LYKAN 奈肯 斩翘 …") that flows into the SVG.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-liberation fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --production=true && npm cache clean --force
COPY --from=builder /app/dist ./dist

EXPOSE 8787
# start-period=60s: Render free-tier cold-start + sharp native module load
# regularly exceeds 10s; under that window the platform recycles the
# container in a boot loop before the first request lands.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
