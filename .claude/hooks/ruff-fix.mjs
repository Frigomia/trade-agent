// PostToolUse hook: after Edit/MultiEdit/Write on a Python file under backend/ run
// `ruff check --fix` on it (from backend/, so pyproject.toml applies). Migrations are skipped
// (pyproject already excludes migrations/versions). Whatever ruff cannot fix is sent back to Claude
// (exit 2) so it gets fixed; a missing `uv` is a non-blocking notice (exit 1).
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BACKEND = path.join(ROOT, "backend");
const VERSIONS = path.join(BACKEND, "migrations", "versions");

const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

function isInside(dir, file) {
  const relative = path.relative(norm(dir), norm(file));
  return relative !== "" && !path.isAbsolute(relative) && !relative.split(path.sep).includes("..");
}

/** The Python file this event should lint (absolute path), or null. Exported for the tests. */
export function targetFor(payload) {
  const tool = payload?.tool_name;
  const filePath = payload?.tool_input?.file_path;
  if (!["Edit", "MultiEdit", "Write"].includes(tool) || typeof filePath !== "string") return null;
  const absolute = path.resolve(payload.cwd ?? process.cwd(), filePath);
  if (path.extname(absolute) !== ".py") return null;
  if (!isInside(BACKEND, absolute) || isInside(VERSIONS, absolute)) return null;
  return absolute;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const target = targetFor(payload);
  if (target === null) process.exit(0);

  const result = spawnSync("uv", ["run", "ruff", "check", "--fix", "--quiet", target], {
    cwd: BACKEND,
    encoding: "utf8",
  });
  if (result.error) {
    process.stderr.write(`ruff hook skipped: could not run uv (${result.error.message})\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(
      `ruff check --fix left problems in ${path.relative(ROOT, target)}:\n` +
        `${result.stdout}${result.stderr}`,
    );
    process.exit(2);
  }
}
