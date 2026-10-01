#!/bin/sh
# 在小主机上构建内存验机文件：Alpine 网络启动内核、modloop，以及带只读工具的 apkovl。
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT="${PXE_DIAG_OUT:-$ROOT/data/diag}"
BRANCH="${ALPINE_BRANCH:-v3.20}"
BASE="https://dl-cdn.alpinelinux.org/alpine/${BRANCH}/releases/x86_64"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 运行：sudo $0" >&2
  exit 1
fi
mkdir -p "$OUT" "$WORK/root" "$WORK/apkovl/usr/local/sbin" "$WORK/apkovl/usr/local/lib/pxe-diag" "$WORK/apkovl/usr/local/lib/pxe-guard" "$WORK/apkovl/etc/local.d"

download() {
  url=$1
  dest=$2
  echo "下载 $url"
  wget -O "$dest" "$url"
}

download "$BASE/netboot/vmlinuz-lts" "$OUT/vmlinuz-lts"
download "$BASE/netboot/initramfs-lts" "$OUT/initramfs-lts"
download "$BASE/netboot/modloop-lts" "$OUT/modloop-lts"

index=$(wget -qO- "$BASE/")
mini=$(printf '%s\n' "$index" | grep -o 'alpine-minirootfs-[0-9.]*-x86_64\.tar\.gz' | sort -V | tail -1)
if [ -z "$mini" ]; then
  echo "没有在 Alpine 目录里找到 minirootfs" >&2
  exit 1
fi
download "$BASE/$mini" "$WORK/minirootfs.tar.gz"
tar -C "$WORK/root" -xzf "$WORK/minirootfs.tar.gz"
if [ -f /etc/resolv.conf ]; then
  cp /etc/resolv.conf "$WORK/root/etc/resolv.conf"
fi
chroot "$WORK/root" /sbin/apk add --no-cache smartmontools dmidecode memtester ethtool pciutils usbutils lm-sensors curl

bins="
/usr/sbin/smartctl
/usr/sbin/dmidecode
/usr/bin/memtester
/usr/sbin/ethtool
/usr/bin/lspci
/usr/bin/lsusb
/usr/bin/sensors
/usr/bin/curl
"
: > "$WORK/files"
for bin in $bins; do
  if [ ! -e "$WORK/root$bin" ]; then
    echo "缺少 $bin" >&2
    exit 1
  fi
  echo "$bin" >> "$WORK/files"
  chroot "$WORK/root" ldd "$bin" 2>/dev/null | sed -n 's/.*=>[[:space:]]*\([^[:space:]]*\).*/\1/p; s/^[[:space:]]*\(\/[^[:space:]]*\).*/\1/p' >> "$WORK/files" || true
done
sort -u "$WORK/files" | while IFS= read -r file; do
  [ -n "$file" ] || continue
  [ -e "$WORK/root$file" ] || continue
  mkdir -p "$WORK/apkovl$(dirname "$file")"
  cp -a "$WORK/root$file" "$WORK/apkovl$file"
done

install -m 0755 "$ROOT/diag/pxe-diag" "$WORK/apkovl/usr/local/sbin/pxe-diag"
install -m 0755 "$ROOT/diag/pxe-guard" "$WORK/apkovl/usr/local/sbin/pxe-guard"
install -m 0644 "$ROOT/diag/block-check.sh" "$WORK/apkovl/usr/local/lib/pxe-diag/block-check.sh"
install -m 0755 "$ROOT/diag/pxe-diag.start" "$WORK/apkovl/etc/local.d/pxe-diag.start"
for name in mount umount dd wipefs mkfs mkfs.ext4 mkfs.xfs mkfs.btrfs; do
  cat > "$WORK/apkovl/usr/local/lib/pxe-guard/$name" << 'EOF'
#!/bin/sh
exec /usr/local/sbin/pxe-guard "$(basename "$0")" "$@"
EOF
  chmod 0755 "$WORK/apkovl/usr/local/lib/pxe-guard/$name"
done

tar -C "$WORK/apkovl" -czf "$OUT/diag.apkovl.tar.gz" .
echo "验机镜像已写入 $OUT"
ls -lh "$OUT"
