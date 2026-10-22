FROM nginx:1.27-alpine
# 控制台 HTTPS 的自建证书在启动时用 openssl 生成，见 tls-init.sh。
RUN apk add --no-cache openssl
COPY --chmod=755 tls-init.sh /docker-entrypoint.d/05-pxe-tls.sh
COPY nginx.conf /etc/nginx/conf.d/default.conf
