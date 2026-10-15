#!/bin/bash
# 把打好的安装包传到 GitHub Releases（每个版本一个 Release，标签 v<版本>，标成 Latest）。
#   release/publish-release.sh /var/tmp/pxe-releases/pxe-<版本>.run [pxe-<版本>-full.run ...]
# 同一版本的首次安装包和升级包放在同一个 Release 里；已经传过的同名文件会替换。
# 用本机 git 存的 GitHub 凭据（credential.helper），不打印出来。
set -euo pipefail

REPO=${PXE_GITHUB_REPO:-Orimengbi/Moblie-auto-pxe}
API=https://api.github.com/repos/$REPO
[ $# -gt 0 ] || { echo "用法：$0 <pxe-版本.run> ..." >&2; exit 2; }

TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')
[ -n "$TOKEN" ] || { echo "没有找到 GitHub 凭据" >&2; exit 1; }
gh_api() { curl -fsS -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "$@"; }
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

field() { head -n 40 "$1" | sed -n "s/^$2='\([^']*\)'\$/\1/p" | head -1; }

for file in "$@"; do
  file=$(readlink -f "$file")
  version=$(field "$file" PXE_RELEASE_VERSION)
  [ -n "$version" ] || { echo "$file 不是安装包" >&2; exit 1; }
  case "$version" in *dirty*) echo "$version 是没提交的改动打的测试包，不发布" >&2; exit 1 ;; esac
  commit=${version##*-}
  tag="v$version"
  name=$(basename "$file")
  sha=$(sha256sum "$file" | cut -d' ' -f1)

  release=$(gh_api "$API/releases/tags/$tag" 2>/dev/null || true)
  if [ -z "$release" ]; then
    full_sha=$(cd "$(dirname "$0")/.." && git rev-parse "$commit")
    body=$(cat <<EOF
Union（资产运维平台）$version 离线安装/升级包。

- \`pxe-$version-full.run\`：首次安装，带 Docker。\`sudo bash pxe-$version-full.run\`
- \`pxe-$version.run\`：升级。控制台「备份和升级」页上传后点「升级」，或 \`sudo bash pxe-$version.run\`

包已签名，正式机只认发布密钥打的包。各文件的 SHA-256 见下方。说明：release/README.md
EOF
)
    release=$(python3 -c 'import json,sys; print(json.dumps({"tag_name":sys.argv[1],"target_commitish":sys.argv[2],"name":"Union "+sys.argv[3],"body":sys.argv[4],"make_latest":"true"}))' "$tag" "$full_sha" "$version" "$body" |
      gh_api -X POST "$API/releases" -d @-)
    echo "建了 Release $tag"
  fi
  id=$(printf '%s' "$release" | json 'd["id"]')

  # 同名附件先删掉再传。
  old=$(printf '%s' "$release" | json "next((a['id'] for a in d.get('assets', []) if a['name'] == '$name'), '')")
  [ -z "$old" ] || gh_api -X DELETE "$API/releases/assets/$old" >/dev/null

  echo "上传 $name（$(du -h "$file" | cut -f1)）……"
  url=$(gh_api -X POST -H "Content-Type: application/octet-stream" --data-binary "@$file" \
    "https://uploads.github.com/repos/$REPO/releases/$id/assets?name=$name" | json 'd["browser_download_url"]')

  # 把这个文件的 SHA-256 记进说明里。
  body=$(gh_api "$API/releases/$id" | json 'd["body"] or ""')
  body=$(printf '%s\n' "$body" | grep -v "^- SHA-256 $name " || true)
  body="$body
- SHA-256 $name \`$sha\`"
  python3 -c 'import json,sys; print(json.dumps({"body":sys.argv[1],"make_latest":"true"}))' "$body" | gh_api -X PATCH "$API/releases/$id" -d @- >/dev/null
  echo "  $url"
done
echo "Releases：https://github.com/$REPO/releases/latest"
