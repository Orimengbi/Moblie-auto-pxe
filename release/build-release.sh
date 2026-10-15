#!/bin/bash
# 在能上网的机器上打离线安装/升级包（一个 .run 文件），拷到正式环境执行或在控制台上传。
#
#   release/build-release.sh                 升级包 pxe-<版本>.run（约 250 MB）
#   release/build-release.sh --with-docker   首次安装包 pxe-<版本>-full.run，多带静态版 Docker 和 compose（多约 120 MB）
#   其他选项：--skip-tests  --allow-dirty  --out 目录（默认 /var/tmp/pxe-releases）  --version 版本号（测试升级时用）
#
# 版本号是「日期-提交号」，比如 2026.10.15-4d5ced0。包用发布密钥签名，正式环境只认这把密钥打的包：
#   私钥 ~/.config/pxe-release/release-key.pem（第一次运行时生成，别进仓库，丢了就只能在正式机上手工换公钥）
#   公钥 release/release.pub（进仓库，装机时放到正式机上）
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
KEY=${PXE_RELEASE_KEY:-$HOME/.config/pxe-release/release-key.pem}
OUT=/var/tmp/pxe-releases
CACHE=/var/tmp/pxe-release-cache
WITH_DOCKER=0
SKIP_TESTS=0
ALLOW_DIRTY=0
VERSION_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --with-docker) WITH_DOCKER=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --out) OUT=$2; shift ;;
    --version) VERSION_OVERRIDE=$2; shift ;;
    *) echo "不认识的选项 $1" >&2; exit 2 ;;
  esac
  shift
done

cd "$ROOT"
dirty=""
if [ -n "$(git status --porcelain)" ]; then
  [ "$ALLOW_DIRTY" = 1 ] || { echo "仓库有没提交的改动，先提交（或加 --allow-dirty 打测试包）" >&2; exit 1; }
  dirty=".dirty"
fi
VERSION=${VERSION_OVERRIDE:-"$(date +%Y.%m.%d)-$(git rev-parse --short=7 HEAD)$dirty"}
[[ $VERSION =~ ^[A-Za-z0-9._-]+$ ]] || { echo "版本号只能有字母、数字和 . _ -" >&2; exit 1; }
SUFFIX=$([ "$WITH_DOCKER" = 1 ] && echo -full || true)
NAME="pxe-$VERSION$SUFFIX.run"
echo "== 打包 $NAME（分支 $(git branch --show-current)）"

# ---- 签名密钥 ----
if [ ! -f "$KEY" ]; then
  echo "== 第一次打包：生成发布密钥 $KEY"
  mkdir -p "$(dirname "$KEY")"
  (umask 077 && openssl ecparam -name prime256v1 -genkey -noout -out "$KEY")
  openssl ec -in "$KEY" -pubout -out release/release.pub 2>/dev/null
  echo "   公钥写到了 release/release.pub，记得提交；私钥请另外备份一份到安全的地方。"
fi
[ -f release/release.pub ] || { echo "缺 release/release.pub" >&2; exit 1; }
if ! diff -q <(openssl ec -in "$KEY" -pubout 2>/dev/null) release/release.pub >/dev/null; then
  echo "私钥 $KEY 和 release/release.pub 不是一对" >&2
  exit 1
fi

# ---- 测试 ----
if [ "$SKIP_TESTS" = 0 ]; then
  echo "== 单元测试"
  docker build --target test -t pxe-console-test console/ >/var/tmp/pxe-release-test.log 2>&1 || { tail -30 /var/tmp/pxe-release-test.log; exit 1; }
  docker run --rm pxe-console-test >>/var/tmp/pxe-release-test.log 2>&1 || { grep -E "^not ok|^# (pass|fail)" /var/tmp/pxe-release-test.log; exit 1; }
  grep -E "^# (pass|fail)" /var/tmp/pxe-release-test.log | tr '\n' ' '
  echo
  docker image rm pxe-console-test >/dev/null
fi

# ---- 镜像 ----
echo "== 构建镜像"
docker build --build-arg "PXE_VERSION=$VERSION" -t "pxe/console:$VERSION" console/ >/var/tmp/pxe-release-build.log 2>&1 || { tail -30 /var/tmp/pxe-release-build.log; exit 1; }
docker build -t "pxe/boot:$VERSION" deploy/nginx >>/var/tmp/pxe-release-build.log 2>&1
docker build -t "pxe/dnsmasq:$VERSION" deploy/dnsmasq >>/var/tmp/pxe-release-build.log 2>&1

WORK=$(mktemp -d /var/tmp/pxe-release-work.XXXX)
trap 'rm -rf "$WORK"' EXIT
P=$WORK/p
mkdir -p "$P/tftp"
echo "== 导出镜像"
gz=$(command -v pigz || echo gzip)
docker save "pxe/console:$VERSION" "pxe/boot:$VERSION" "pxe/dnsmasq:$VERSION" | "$gz" -6 >"$P/images.tar.gz"

cp release/pxectl release/compose.yml release/nginx.conf.tmpl release/release.pub "$P/"
cp -r release/systemd "$P/"
chmod 755 "$P/pxectl"
printf '%s\n' "$VERSION" >"$P/VERSION"

# ---- iPXE 固件：在用的那份，没有就下载 ----
IPXE_DIR=${IPXE_DIR:-}
for dir in "$IPXE_DIR" /opt/pxe/data/tftp /opt/mobile-auto-pxe/data/tftp "$ROOT/data/tftp" "$CACHE/tftp"; do
  if [ -n "$dir" ] && [ -s "$dir/ipxe.efi" ] && [ -s "$dir/undionly.kpxe" ]; then IPXE_DIR=$dir; break; fi
done
if [ ! -s "${IPXE_DIR:-/nonexistent}/ipxe.efi" ]; then
  mkdir -p "$CACHE/tftp"
  wget -q --https-only -O "$CACHE/tftp/ipxe.efi" https://boot.ipxe.org/ipxe.efi
  wget -q --https-only -O "$CACHE/tftp/undionly.kpxe" https://boot.ipxe.org/undionly.kpxe
  IPXE_DIR=$CACHE/tftp
fi
cp "$IPXE_DIR/ipxe.efi" "$IPXE_DIR/undionly.kpxe" "$P/tftp/"

# ---- 静态版 Docker（首次安装包） ----
if [ "$WITH_DOCKER" = 1 ]; then
  DOCKER_VERSION=${DOCKER_VERSION:-$(docker version --format '{{.Server.Version}}')}
  COMPOSE_VERSION=${COMPOSE_VERSION:-$(docker compose version --short | sed 's/^v//')}
  mkdir -p "$CACHE" "$P/docker"
  tgz="$CACHE/docker-$DOCKER_VERSION.tgz"
  if [ ! -s "$tgz" ]; then
    echo "== 下载 Docker $DOCKER_VERSION"
    wget -q --https-only -O "$tgz.part" "https://download.docker.com/linux/static/stable/x86_64/docker-$DOCKER_VERSION.tgz"
    mv "$tgz.part" "$tgz"
  fi
  bin="$CACHE/docker-compose-$COMPOSE_VERSION"
  if [ ! -s "$bin" ]; then
    echo "== 下载 docker compose $COMPOSE_VERSION"
    url="https://github.com/docker/compose/releases/download/v$COMPOSE_VERSION/docker-compose-linux-x86_64"
    wget -q --https-only -O "$bin.part" "$url"
    want=$(wget -q --https-only -O- "$url.sha256" | cut -d' ' -f1)
    [ "$(sha256sum "$bin.part" | cut -d' ' -f1)" = "$want" ] || { echo "compose 校验和不对" >&2; exit 1; }
    mv "$bin.part" "$bin"
  fi
  cp "$tgz" "$P/docker/"
  install -m 755 "$bin" "$P/docker/docker-compose"
fi

# ---- 拼成 .run：一段 shell + tar ----
echo "== 打包、签名"
tar -cf "$WORK/payload.tar" -C "$P" .
SHA=$(sha256sum "$WORK/payload.tar" | cut -d' ' -f1)
SIG=$(openssl dgst -sha256 -sign "$KEY" "$WORK/payload.tar" | base64 -w0)
BUILT=$(date -u +%FT%TZ)

header() { # 行数
  cat <<EOF
#!/bin/bash
# Union（资产运维平台）离线安装/升级包。用 root 执行：sudo bash $NAME
# 没装过就安装（会问管理口地址和装机网口，也可以用 --mgmt-ip --install-if --install-ip --port --yes 直接给），装过就升级。
# 下面几行由打包脚本生成，控制台和 pxectl 也按这个格式读，别改。
PXE_RELEASE_VERSION='$VERSION'
PXE_RELEASE_BUILT='$BUILT'
PXE_RELEASE_DOCKER='$WITH_DOCKER'
PXE_RELEASE_SHA256='$SHA'
PXE_RELEASE_SIG='$SIG'
PXE_RELEASE_LINES='$1'
set -euo pipefail
[ "\$(id -u)" = 0 ] || { echo "要用 root 执行：sudo bash \$0" >&2; exit 1; }
self=\$(readlink -f "\$0")
home=\${PXE_HOME:-/opt/pxe}
prev=""
for arg in "\$@"; do [ "\$prev" = --home ] && home=\$arg; prev=\$arg; done
work=\$(mktemp -d /var/tmp/pxe-install.XXXXXX)
trap 'rm -rf "\$work"' EXIT
echo "解包 \$PXE_RELEASE_VERSION ……"
tail -n "+\$((PXE_RELEASE_LINES + 1))" "\$self" >"\$work/payload.tar"
[ "\$(sha256sum "\$work/payload.tar" | cut -d' ' -f1)" = "\$PXE_RELEASE_SHA256" ] || { echo "安装包损坏（校验和不对），重新拷一份" >&2; exit 1; }
if [ -f "\$home/release.pub" ]; then
  if command -v openssl >/dev/null 2>&1; then
    printf '%s' "\$PXE_RELEASE_SIG" | base64 -d >"\$work/payload.sig"
    openssl dgst -sha256 -verify "\$home/release.pub" -signature "\$work/payload.sig" "\$work/payload.tar" >/dev/null 2>&1 || { echo "签名不对：不是用发布密钥打的包，拒绝安装" >&2; exit 1; }
  else
    echo "（没有 openssl，跳过验签；网页升级时宿主机会用控制台镜像里的 openssl 验）"
  fi
fi
mkdir "\$work/p"
tar -xf "\$work/payload.tar" -C "\$work/p"
rm -f "\$work/payload.tar"
rc=0
PXE_HOME=\$home PXE_BUNDLE_FILE="\$self" bash "\$work/p/pxectl" bundle-install "\$work/p" "\$@" || rc=\$?
exit \$rc
EOF
}
lines=$(header 0 | wc -l)
mkdir -p "$OUT"
{ header "$lines"; cat "$WORK/payload.tar"; } >"$OUT/$NAME.part"
chmod 755 "$OUT/$NAME.part"
mv -f "$OUT/$NAME.part" "$OUT/$NAME"

echo "== 好了：$OUT/$NAME  $(du -h "$OUT/$NAME" | cut -f1)"
echo "   sha256 $(sha256sum "$OUT/$NAME" | cut -d' ' -f1)"
# 本机留着最新一版的镜像就够了。本机也装着平台时（/opt/pxe/releases），那几个版本归 pxectl 管，回滚要用，不删。
for old in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^pxe/(console|boot|dnsmasq):' | grep -v ":$VERSION\$"); do
  [ -d "/opt/pxe/releases/${old##*:}" ] && continue
  docker image rm "$old" >/dev/null 2>&1 || true
done
