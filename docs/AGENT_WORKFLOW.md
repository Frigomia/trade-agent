# Coding-agent workflow

## Shared instructions

All agents follow [root AGENTS.md](../AGENTS.md), then the scoped
[backend](../backend/AGENTS.md) or [frontend](../frontend/AGENTS.md) guide for the files they touch.
The three `CLAUDE.md` files import their sibling `AGENTS.md`; maintain shared rules there so
Claude Code, Codex and other agents read the same conventions. A host without automatic discovery
must read the applicable files explicitly.

Ponytail's [coding skill](../.agents/skills/ponytail/SKILL.md) and
[review skill](../.agents/skills/ponytail-review/SKILL.md) are vendored from the owner's specified
upstream, with [revision and license](../.agents/skills/README.md). Codex can discover them as
project skills (`$ponytail`, `$ponytail-review`) in a new session. Any agent can read and follow
the files directly; that is the supported instruction-only path, not a claim that a native plugin
command executed. Announce the path used. If either file is unavailable, report the prerequisite
and finish independent documentation work rather than claiming the workflow ran.

## Before changing code

Read the Ponytail coding skill first, default full mode. Trace the affected code and callers;
choose the smallest complete change, preserving validation, error handling and security.

Protect every existing file under `backend/migrations/versions/`. Generate Alembic revisions
instead of hand-editing them. This rule applies to patches, shell scripts and every editor,
regardless of whether a hook recognizes its name. A new RLS migration may have a hand-written
body. Preserve pre-existing user changes.

The existing migration guard is a standalone Node command and can be called from any host. It
reads one JSON event on stdin. Run from the repository root; for example, check a planned edit:

```bash
node .claude/hooks/guard-migrations.mjs <<'JSON'
{"tool_name":"Edit","tool_input":{"file_path":"backend/app/config.py"}}
JSON
```

Use `Edit` for modification or deletion through any tool, including `apply_patch` and shell
commands. Use `Write` only for a genuinely new file. Run a check for every target path in a
multi-file change. Supply `cwd` in the JSON event if invoking outside the repo root. A guard
rejection exits 2 and explains the migration rule; do not ignore it or disguise an edit as a
creation. Alembic generation remains allowed. The command validates paths and symlinks; it does
not intercept commands run by an arbitrary host, so the instruction still applies when no hook
fires. There is no marker-file bypass for another agent.

## After editing Python

Run the same Ruff action as the Claude hook, with the changed non-migration file paths relative
to `backend/`:

```bash
cd backend
uv run ruff check --fix app/config.py
```

Pass all changed Python files, fix remaining findings and preserve the command's exit status.
Then run scoped lint, formatting, type and test checks before calling application code done.
Do not run two backend test suites concurrently against the shared `trading_agent_test` database.
For documentation-only changes, validate links/imports and any affected workflow behavior;
application builds do not establish that instruction files load correctly.

## Before finishing

Read the Ponytail review skill and review the final diff plus connected callers. Fix concrete
findings and rerun affected checks. Record the target and actual test results in the handoff.
Do not mark a review complete merely because a tool requested one; changed code after a review
needs a fresh look. Claude users also retain their existing `/code-review` stop-hook step. That hook
asks once for each commit the work sits on top of, not each time the working tree changes, so fixing
what a review found does not start another round; judge for yourself whether a larger later change
needs its own review, and committing starts a new unit of work that is asked about again.

For auth, RLS or AI prompt changes, use an independent security-reviewer subagent with the
[shared checklist](../.agents/security-review.md). Claude's adapter is
[.claude/agents/security-reviewer.md](../.claude/agents/security-reviewer.md). Other hosts pass
the same checklist and diff to their own review agent. If a host has no subagent capability,
apply the checklist directly and disclose that independent review was unavailable.

## Automatic hooks and native plugins

`.claude/settings.json` and its scripts stay in place for Claude Code. The Ponytail hook requires
an actual `ponytail:ponytail` Skill event in that session; simply reading a file does not satisfy
that native hook. Never create `/tmp/claude-ponytail-*` markers to pretend it did. The stop hook
asks for `/code-review` once per working-tree state; it does not prove a review occurred.

Hosts that do not execute Claude hooks must follow the shared steps above. `AGENTS.md` is an
instruction contract, not a universal interception mechanism; this PR does not claim that Codex
executes `.claude/settings.json` automatically.

For native Ponytail commands/lifecycle hooks instead of the vendored instruction-only path,
upstream documents these separate installation commands:

```text
Claude Code:
  /plugin marketplace add DietrichGebert/ponytail
  /plugin install ponytail@ponytail

Codex CLI:
  codex plugin marketplace add DietrichGebert/ponytail
  codex plugin add ponytail@ponytail
```

In Codex, upstream also requires trusting the two lifecycle hooks in `/hooks` and starting a new
thread. Plugin installation and hook trust are host/user setup, not performed by these docs or
required to read the pinned skills. Native plugin revisions may differ from the vendored pin;
keep the repository's safety rules in force either way. See the pinned upstream README before
changing installation commands. No secrets or API credentials are needed for the vendored path.

Validate the preserved Claude migration/Ruff scripts with:

```bash
UV_CACHE_DIR=/workspace/.cache/uv node --test .claude/hooks/hooks.test.mjs
```

The cache override is useful in this cloud workspace, whose home directory is read-only; omit
it on a machine with a writable default uv cache. The scripts also need Node, uv and jq as
appropriate for the existing hooks. No new runtime dependency is introduced.
