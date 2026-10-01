#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
BIN=$(mktemp -d)
LOG="$BIN/called"
MOCK="$BIN/mock"
cat > "$MOCK" << 'EOF'
#!/bin/sh
echo called >> "$PXE_MOCK_LOG"
exit 0
EOF
chmod +x "$MOCK"
for name in dd mount mkfs.ext4; do
  cp "$MOCK" "$BIN/$name"
done
export PXE_GUARD_BIN_ROOT="$BIN"
export PXE_MOCK_LOG="$LOG"

fail() {
  echo "FAIL $1" >&2
  exit 1
}

set +e
"$ROOT/pxe-guard" dd if=/dev/zero of=/dev/sda bs=1 count=1
status=$?
set -e
[ "$status" -eq 99 ] || fail "dd of=/dev/sda should exit 99, got $status"
[ ! -f "$LOG" ] || fail "refused dd still executed"

set +e
"$ROOT/pxe-guard" mount /dev/nvme0n1 /mnt
status=$?
set -e
[ "$status" -eq 99 ] || fail "mount nvme should exit 99"

"$ROOT/pxe-guard" dd if=/dev/zero of=/tmp/pxe-guard-ok bs=1 count=1
grep -q called "$LOG" || fail "safe dd was blocked"

. "$ROOT/block-check.sh"
good=$(mktemp)
bad=$(mktemp)
printf '%s\n' 'echo 只打印' > "$good"
printf '%s\n' 'mkfs.ext4 /dev/sda' > "$bad"
if pxe_script_blocked "$good"; then
  fail "plain echo was blocked"
fi
pxe_script_blocked "$bad" || fail "mkfs.ext4 was allowed"
echo "guard ok"
