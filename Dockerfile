FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN pnpm install --frozen-lockfile
COPY backend backend
COPY frontend frontend
RUN pnpm build
RUN pnpm --filter @jdrive/api deploy --prod --legacy /prod/api

FROM node:22-alpine
RUN apk add --no-cache libstdc++ && addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app app
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 FILES_DIR=/app/data/files TMP_DIR=/app/data/tmp
RUN mkdir -p /app/data/files /app/data/tmp && chown -R 10001:10001 /app/data
COPY --from=build --chown=10001:10001 /prod/api ./backend
COPY --from=build --chown=10001:10001 /app/backend/dist ./backend/dist
COPY --from=build --chown=10001:10001 /app/frontend/dist ./frontend/dist
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
USER 10001:10001
EXPOSE 3000
ENTRYPOINT ["/bin/sh", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "backend/dist/server.js"]
