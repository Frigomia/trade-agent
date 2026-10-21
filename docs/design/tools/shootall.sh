#!/bin/bash
# Regenerate screenshots of the mocks that have desk, phones and states sections
# (today-discovery, company-overview, portfolio, discover).
# usage: docs/design/tools/shootall.sh <folder> <page>:<key> [...]
#   e.g. docs/design/tools/shootall.sh discover dc-a-list:dca
#   WIN=1340 sets the window width; CHROME points at chrome if it is not at the default Windows path.
# Writes <folder>/shots/<key>-<section>-<theme>.png at each section's real height (needs Git Bash and headless Chrome).
# Screenshots are not tracked in git, except where a folder's shots/.gitignore says so.
set -u
FOLDER="${1:?folder, for example discover}"; shift
[ $# -gt 0 ] || { echo "give at least one page:key" >&2; exit 1; }
cd "$(cd "$(dirname "$0")/.." && pwd)/$FOLDER" || exit 1
CH="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
[ -x "$CH" ] || { echo "Chrome not found: $CH" >&2; exit 1; }
W="$(pwd -W 2>/dev/null || pwd)"; mkdir -p shots
for f in "$@"; do
  page=${f%%:*}; key=${f##*:}
  for sec in desk phones states; do
    for theme in dark light; do
      url="file:///$W/$page.html?theme=$theme&only=$sec"
      h=$("$CH" --headless=new --disable-gpu --window-size="${WIN:-1340}",900 --virtual-time-budget=6000 --dump-dom "$url" 2>/dev/null | grep -o 'data-h="[0-9]*"' | head -1 | grep -o '[0-9]*')
      [ -n "$h" ] || { echo "no height for $url" >&2; continue; }
      "$CH" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size="${WIN:-1340}",$((h+10)) --virtual-time-budget=6000 --screenshot="$W/shots/$key-$sec-$theme.png" "$url" >/dev/null 2>&1
      echo "$key-$sec-$theme h=$h"
    done
  done
done
