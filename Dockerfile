FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN pnpm install --frozen-lockfile
COPY backend backend
COPY frontend frontend
RUN pnpm build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/backend/dist ./backend/dist
COPY --from=build --chown=app:app /app/backend/package.json ./backend/package.json
COPY --from=build --chown=app:app /app/backend/node_modules ./backend/node_modules
USER app
EXPOSE 3000
CMD ["node", "backend/dist/server.js"]
