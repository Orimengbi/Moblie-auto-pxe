#!/bin/sh
# 控制台 HTTPS 用的证书，nginx 启动前由官方镜像的 /docker-entrypoint.d/ 调用。
#
# 证书放在 /tls（挂的是 data/tls，可写），nginx 用 active.crt / active.key：
# - data/tls 里有 custom.crt + custom.key（公司 CA 或买的证书，crt 里带上中间证书）就用它们；
# - 否则用这里自建的：本机专用的根证书 ca.crt 签一张服务器证书 server.crt。
#   根证书带名称约束，只能给这台机器的管理口地址签证书，私钥泄露了也冒充不了别的网站。
#   浏览器导入一次 ca.crt（控制台登录页可以下载）以后就不再报不安全。
#
# 证书里的地址：环境变量 PXE_TLS_HOSTS，没有就读 /tls/hosts（正式环境 pxectl 按 site.env 写），逗号或空格隔开，
# IP 或域名都行，127.0.0.1 和 localhost 总会加上。地址变了重签服务器证书；根证书的约束管不到新地址时根证书也重做，要重新导入。
set -eu

dir=${PXE_TLS_DIR:-/tls}
mkdir -p "$dir"
cd "$dir"

if [ -s custom.crt ] && [ -s custom.key ]; then
  ln -sf custom.crt active.crt
  ln -sf custom.key active.key
  echo "[tls] 用 data/tls 里的 custom.crt"
  exit 0
fi

hosts=${PXE_TLS_HOSTS:-}
[ -n "$hosts" ] || hosts=$(cat hosts 2>/dev/null || true)
# 去重、排序，换行分隔，好比较。
hosts=$(printf '%s 127.0.0.1 localhost\n' "$hosts" | tr ', ' '\n\n' | sed '/^$/d' | sort -u)

is_ip() { printf '%s' "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; }

san=""
permitted=""
for host in $hosts; do
  if is_ip "$host"; then
    san="$san,IP:$host"
    permitted="$permitted,permitted;IP:$host/255.255.255.255"
  else
    san="$san,DNS:$host"
    permitted="$permitted,permitted;DNS:$host"
  fi
done
san=${san#,}
permitted=${permitted#,}

if [ ! -s ca.key ] || [ ! -s ca.crt ] || [ "$(cat ca.hosts 2>/dev/null)" != "$hosts" ]; then
  # 根证书只给 hosts 里的地址签：地址一变就重做，旧的作废。
  name="PXE Console Root CA $(hostname) $(date +%Y%m%d)"
  openssl ecparam -name prime256v1 -genkey -noout -out ca.key.new
  openssl req -x509 -new -key ca.key.new -sha256 -days 3650 -subj "/O=PXE Console/CN=$name" \
    -addext "basicConstraints=critical,CA:true,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "nameConstraints=critical,$permitted" \
    -out ca.crt.new
  chmod 600 ca.key.new
  mv -f ca.key.new ca.key
  mv -f ca.crt.new ca.crt
  printf '%s\n' "$hosts" >ca.hosts
  rm -f server.crt server.key
  echo "[tls] 新建了根证书：$name。浏览器要重新导入 ca.crt"
fi

if [ ! -s server.key ] || [ ! -s server.crt ] || [ "$(cat server.hosts 2>/dev/null)" != "$hosts" ] ||
  ! openssl x509 -checkend 2592000 -noout -in server.crt >/dev/null 2>&1; then
  openssl ecparam -name prime256v1 -genkey -noout -out server.key.new
  cn=$(printf '%s\n' "$hosts" | grep -v -e '^127\.' -e '^localhost$' | head -1 || true)
  openssl req -new -key server.key.new -subj "/O=PXE Console/CN=${cn:-localhost}" -out server.csr
  printf 'basicConstraints=critical,CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$san" >server.ext
  openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -sha256 -days 825 -extfile server.ext -out server.crt.new
  chmod 600 server.key.new
  mv -f server.key.new server.key
  mv -f server.crt.new server.crt
  rm -f server.csr server.ext
  printf '%s\n' "$hosts" >server.hosts
  echo "[tls] 签了服务器证书：$(printf '%s' "$san" | tr ',' ' ')"
fi

ln -sf server.crt active.crt
ln -sf server.key active.key
