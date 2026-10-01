#!/bin/sh
# 上传脚本在执行前先过一遍静态检查，拦住明文写盘命令。
pxe_script_blocked() {
  file=$1
  grep -E -q '(mkfs([.][a-z0-9]+)?|wipefs|fdisk|parted|sgdisk|mkswap|shred)[[:space:]].*/dev/(sd|nvme|mmcblk|vd|hd|xvd)' "$file" && return 0
  grep -E -q 'dd[[:space:]].*of=/dev/(sd|nvme|mmcblk|vd|hd|xvd)' "$file" && return 0
  grep -E -q 'mount[[:space:]].*/dev/(sd|nvme|mmcblk|vd|hd|xvd)' "$file" && return 0
  grep -E -q '>[>]?[[:space:]]*/dev/(sd|nvme|mmcblk|vd|hd|xvd)' "$file" && return 0
  return 1
}
