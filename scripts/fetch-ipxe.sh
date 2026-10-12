#!/bin/sh
# 下载 iPXE 固件。boot.ipxe.org 会重新编译，文件会变，所以默认不锁哈希：
# 先下到临时文件，检查确实是对应格式的启动文件，再替换，最后打出 SHA-256 供核对。
# 要锁版本时设 IPXE_EFI_SHA256 / IPXE_KPXE_SHA256，对不上就不替换。
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DEST="$ROOT/data/tftp"
mkdir -p "$DEST"

fetch() {
  name=$1 magic=$2 min=$3 want=$4
  tmp="$DEST/.$name.download"
  rm -f "$tmp"
  if ! wget -q --https-only -O "$tmp" "https://boot.ipxe.org/$name"; then
    rm -f "$tmp"
    echo "$name 下载失败，没有替换" >&2
    exit 1
  fi
  size=$(wc -c <"$tmp")
  head=$(od -An -tx1 -N2 "$tmp" | tr -d ' \n')
  case "$head" in "$magic"*) ok=1 ;; *) ok=0 ;; esac
  if [ "$size" -lt "$min" ] || [ "$ok" = 0 ]; then
    rm -f "$tmp"
    echo "$name 下载的内容不像 iPXE 固件（$size 字节，开头 $head），没有替换" >&2
    exit 1
  fi
  sum=$(sha256sum "$tmp" | cut -d' ' -f1)
  if [ -n "$want" ] && [ "$sum" != "$want" ]; then
    rm -f "$tmp"
    echo "$name 的 SHA-256 是 $sum，和要求的 $want 不一致，没有替换" >&2
    exit 1
  fi
  mv -f "$tmp" "$DEST/$name"
  echo "$name  $sum"
}

# ipxe.efi 是 PE 文件，以 MZ（4d5a）开头；undionly.kpxe 以实模式远跳转（ea）开头。
fetch ipxe.efi 4d5a 100000 "${IPXE_EFI_SHA256:-}"
fetch undionly.kpxe ea 20000 "${IPXE_KPXE_SHA256:-}"
echo "iPXE 固件已放到 $DEST"
