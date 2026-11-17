# 容器化运行 Next.js 生产服务（供 Hugging Face Spaces / 任意 Docker 平台使用）。
# 监听 7860 端口 —— HF Spaces 的默认 app_port；其他平台可用 -e PORT 覆盖。

FROM node:20-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# NEXT_PUBLIC_* 是构建期内联，必须在 build 阶段可见（HF 的 secrets 构建期不可见，故 OG 地址可能回落 localhost）
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# 只装生产依赖，镜像比整包拷贝小得多
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
EXPOSE 7860
CMD ["npx", "next", "start", "-p", "7860", "-H", "0.0.0.0"]
