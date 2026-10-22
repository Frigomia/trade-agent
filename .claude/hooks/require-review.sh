#!/bin/bash
# Stop hook: after code changes, ask for one /code-review per commit.
# The review is asked for once for each commit the work sits on top of, not once per state of the
# working tree: fixing what a review found changes the tree, and asking again each time never ends.
# Committing starts a new unit of work, so the next change is asked about again.
INPUT=$(cat)
[ "$(echo "$INPUT" | jq -r '.stop_hook_active')" = "true" ] && exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
[ -z "$(git status --porcelain 2>/dev/null)" ] && exit 0          # nothing changed
BASE=$(git rev-parse HEAD 2>/dev/null || echo none)
MARK="/tmp/claude-review-$(echo "$INPUT" | jq -r '.session_id')"
[ "$(cat "$MARK" 2>/dev/null)" = "$BASE" ] && exit 0               # already asked on top of this commit
echo "$BASE" > "$MARK"
jq -n '{decision:"block", reason:"Code changed. Run /code-review on the changes, then address its findings before finishing."}'
