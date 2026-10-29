FROM node:26-trixie-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.26.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/clients/package.json packages/clients/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/runtime/package.json packages/runtime/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:26-trixie-slim AS runtime
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates gosu \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system fx42 \
  && useradd --system --uid 10001 --gid fx42 fx42 \
  && mkdir -p /data /run/fx42 \
  && chown -R fx42:fx42 /data /run/fx42
COPY docker/dn42-root-ca.crt /usr/local/share/ca-certificates/dn42.crt
RUN update-ca-certificates
ENV NODE_ENV=production
ENV NODE_USE_SYSTEM_CA=1
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000
COPY --from=build /app/.output /app/.output
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/config /app/config
COPY --from=build /app/package.json /app/package.json
COPY docker/entrypoint.sh /usr/local/bin/fx42-entrypoint
RUN chmod 0755 /usr/local/bin/fx42-entrypoint
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["fx42-entrypoint"]
CMD ["node", ".output/server/index.mjs"]
