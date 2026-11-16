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

# Distroless ships Node without npm, a shell or a package manager, so the scanner only sees what the app runs.
# The dependencies are plain JavaScript (no native addons), so installing them on musl is fine for this glibc base.
FROM gcr.io/distroless/nodejs24-debian13 AS runtime
ARG GIRICI_VERSION=dev
ENV NODE_ENV=production GIRICI_VERSION=$GIRICI_VERSION PATH=/nodejs/bin:$PATH
LABEL org.opencontainers.image.version=$GIRICI_VERSION
WORKDIR /app
COPY --from=deps /app ./
COPY LICENSE ./
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/web/dist packages/web/dist
COPY reset-admin-password.js ./
# The SQLite database lives here. UID 1000 matches the node user of earlier alpine images, so existing volumes stay
# writable. A COPY instead of RUN keeps this stage free of commands, so building it for another architecture needs
# no emulation.
ENV GIRICI_DATA_DIR=/data
COPY --from=deps --chown=1000:1000 /empty /data
VOLUME ["/data"]
USER 1000:1000
EXPOSE 3000
# No shell or wget in the image, so Node does the probe itself.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/healthz`, { signal: AbortSignal.timeout(2500) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT []
CMD ["node", "packages/server/dist/index.js"]
