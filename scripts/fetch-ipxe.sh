#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DEST="$ROOT/data/tftp"
mkdir -p "$DEST"
wget -O "$DEST/ipxe.efi" https://boot.ipxe.org/ipxe.efi
wget -O "$DEST/undionly.kpxe" https://boot.ipxe.org/undionly.kpxe
echo "iPXE 固件已放到 $DEST"
