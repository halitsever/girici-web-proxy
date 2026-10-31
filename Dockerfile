# syntax=docker/dockerfile:1

# The build output and the runtime dependencies are plain JavaScript, so both stages run natively on the builder.
# Running Node for another architecture under QEMU is slow, and some Node images crash there.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci
COPY . .
RUN npm run build

FROM --platform=$BUILDPLATFORM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --omit=dev --ignore-scripts --workspace @girici/server && npm cache clean --force && mkdir /empty

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
COPY LICENSE ./
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/web/dist packages/web/dist
COPY reset-admin-password.js ./
# The SQLite database lives here; the node user owns it so a mounted volume stays writable. A COPY instead of RUN
# keeps this stage free of commands, so building it for another architecture needs no emulation.
ENV GIRICI_DATA_DIR=/data
COPY --from=deps --chown=node:node /empty /data
VOLUME ["/data"]
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/healthz" >/dev/null || exit 1
CMD ["node", "packages/server/dist/index.js"]
