#!/bin/bash
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
case "$FILE" in *.md|*.json|*.txt|*.lock) exit 0;; esac   # don't gate docs/config
SID=$(echo "$INPUT" | jq -r ".session_id // empty")
[ -n "$SID" ] && [ -f "/tmp/claude-ponytail-$SID" ] && exit 0
echo "Blocked: invoke the ponytail:ponytail skill before writing code." >&2
exit 2