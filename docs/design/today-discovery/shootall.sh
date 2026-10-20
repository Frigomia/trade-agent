#!/bin/bash
# usage: shootall.sh  -> shots/<dir>-<section>-<theme>.png at each section's real height
cd "$(cd "$(dirname "$0")" && pwd)"
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"
W="$(pwd -W)"; mkdir -p shots; [ -x "$CH" ] || { echo "Chrome not found: $CH" >&2; exit 1; }
PAGES="${@:-a-gallery:a b-pulse:b c-ledger:c}"
for f in $PAGES; do
  page=${f%%:*}; key=${f##*:}
  for sec in desk phones states; do
    for theme in dark light; do
      url="file:///$W/$page.html?theme=$theme&only=$sec"
      h=$("$CH" --headless=new --disable-gpu --window-size=${WIN:-1340},900 --virtual-time-budget=6000 --dump-dom "$url" 2>/dev/null | grep -o 'data-h="[0-9]*"' | head -1 | grep -o '[0-9]*')
      [ -n "$h" ] || { echo "no height for $url" >&2; continue; }
      "$CH" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=${WIN:-1340},$((h+10)) --virtual-time-budget=6000 --screenshot="$W/shots/$key-$sec-$theme.png" "$url" >/dev/null 2>&1
      echo "$key-$sec-$theme h=$h"
    done
  done
done
