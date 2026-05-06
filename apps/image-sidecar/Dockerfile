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
