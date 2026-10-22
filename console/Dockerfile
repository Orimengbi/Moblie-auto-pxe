# 运行时要用的命令行工具，构建、测试和运行三个阶段共用，测试跑出来的结果和线上一样。
FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends xorriso xz-utils zstd bzip2 openssl ca-certificates ipmitool openssh-client snmp poppler-utils \
  && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 跑全部单元测试：docker build --target test -t pxe-console-test console/ && docker run --rm pxe-console-test
FROM build AS test
CMD ["npm", "test"]

FROM base
# 发布脚本按版本号构建（release/build-release.sh），控制台页面和 /api/health 显示它。
ARG PXE_VERSION=dev
ENV PXE_VERSION=$PXE_VERSION
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/lib ./lib
# OpenBMC 的远程控制台用 noVNC（ES 模块），由 KVM 代理直接发给浏览器；standalone 输出不带它。
COPY --from=build /app/node_modules/@novnc/novnc ./novnc
COPY --from=build /app/scripts ./scripts
ENV PORT=3000
ENV PXE_DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.js"]
