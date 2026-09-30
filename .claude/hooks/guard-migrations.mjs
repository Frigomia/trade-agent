// PreToolUse hook: backend/migrations/versions/ holds generated Alembic migrations and must not be
// hand-edited (root CLAUDE.md). Blocks Edit/MultiEdit on anything there, and Write over an
// existing file there. Creating a NEW file is allowed, so `alembic revision -m ...` followed by
// writing the body (needed for hand-written RLS policies) still works. The alembic CLI writes
// files itself, never through these tools, so it is never blocked.
//
// Limit: a shell redirect or `sed -i` through the Bash tool is not covered.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERSIONS = path.join(ROOT, "backend", "migrations", "versions");

const MESSAGE =
  "Blocked: backend/migrations/versions/ holds generated migrations and must not be hand-edited. " +
  'Create one with `uv run alembic revision --autogenerate -m "..."` (run in backend/). ' +
  "A new file may still be created with Write, for example after `alembic revision -m ...` " +
  "when a migration needs a hand-written RLS policy.";

// Windows and macOS file systems are case-insensitive by default.
const norm = (p) => (["win32", "darwin"].includes(process.platform) ? p.toLowerCase() : p);

// Follows symlinks (of the file, or of its folder when the file does not exist yet).
function real(p) {
  try {
    return realpathSync.native(p);
  } catch {
    try {
      return path.join(realpathSync.native(path.dirname(p)), path.basename(p));
    } catch {
      return p;
    }
  }
}

function isInside(dir, file) {
  const relative = path.relative(norm(real(dir)), norm(real(file)));
  return relative !== "" && !path.isAbsolute(relative) && !relative.split(path.sep).includes("..");
}

/** Pure decision, exported for the tests: { block: boolean, reason?: string }. */
export function decide(payload, { exists = existsSync } = {}) {
  const tool = payload?.tool_name;
  const filePath = payload?.tool_input?.file_path;
  if (!["Edit", "MultiEdit", "Write"].includes(tool) || typeof filePath !== "string") {
    return { block: false };
  }
  const absolute = path.resolve(payload.cwd ?? process.cwd(), filePath);
  if (!isInside(VERSIONS, absolute)) return { block: false };
  if (tool === "Write" && !exists(absolute)) return { block: false };
  return { block: true, reason: MESSAGE };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0); // unreadable input: never block on a hook bug
  }
  const { block, reason } = decide(payload);
  if (block) {
    process.stderr.write(`${reason}\n`);
    process.exit(2);
  }
}
