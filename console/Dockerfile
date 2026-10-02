FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends xorriso openssl ca-certificates ipmitool \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/lib ./lib
COPY --from=build /app/scripts ./scripts
ENV PORT=3000
ENV PXE_DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.js"]
