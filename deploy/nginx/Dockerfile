FROM nginx:1.27-alpine
# 远程控制台走 HTTPS（BMC 的网页只在 HTTPS 下正常工作）。构建时生成自签证书，浏览器第一次打开要点「继续访问」。
# 要换成自己的证书，把 cert.pem 和 key.pem 挂到 /etc/nginx/kvm/ 覆盖它们。
RUN apk add --no-cache openssl \
  && mkdir -p /etc/nginx/kvm \
  && openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=pxe-remote-console" \
       -keyout /etc/nginx/kvm/key.pem -out /etc/nginx/kvm/cert.pem \
  && apk del openssl
COPY nginx.conf /etc/nginx/conf.d/default.conf
