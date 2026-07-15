FROM node:22-alpine AS build
WORKDIR /app
ENV PNPM_CONFIG_FETCH_RETRIES=5 \
    PNPM_CONFIG_FETCH_RETRY_MINTIMEOUT=10000 \
    PNPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    PNPM_CONFIG_FETCH_TIMEOUT=600000
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PNPM_CONFIG_FETCH_RETRIES=5 \
    PNPM_CONFIG_FETCH_RETRY_MINTIMEOUT=10000 \
    PNPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    PNPM_CONFIG_FETCH_TIMEOUT=600000
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY drizzle.config.ts ./
# 交付物参照模板（/api/deliverable-template 下载端点的静态文件源）
COPY docs/templates ./docs/templates
EXPOSE 3000
CMD ["node", "dist/index.js"]
