// Run with: node --test .claude/hooks/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "./guard-migrations.mjs";
import { targetFor } from "./ruff-fix.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const VERSIONS = path.join(ROOT, "backend", "migrations", "versions");
const existing = path.join(VERSIONS, "bc2cf87d8334_add_equity_curve_to_backtest_results.py");
const brandNew = path.join(VERSIONS, "0000_brand_new_probe.py");

const payload = (tool_name, file_path) => ({ tool_name, tool_input: { file_path } });
const run = (script, body) =>
  spawnSync("node", [path.join(HERE, script)], { input: JSON.stringify(body), encoding: "utf8" });

test("guard blocks Edit and MultiEdit anywhere in migrations/versions", () => {
  assert.equal(decide(payload("Edit", existing)).block, true);
  assert.equal(decide(payload("MultiEdit", brandNew)).block, true);
});

test("guard blocks Write over an existing migration but allows a new file", () => {
  assert.equal(decide(payload("Write", existing), { exists: () => true }).block, true);
  assert.equal(decide(payload("Write", brandNew), { exists: () => false }).block, false);
});

test("guard leaves everything else alone", () => {
  const model = path.join(ROOT, "backend", "app", "models.py");
  assert.equal(decide(payload("Edit", model)).block, false);
  assert.equal(decide(payload("Edit", path.join(ROOT, "backend", "migrations", "env.py"))).block, false);
  assert.equal(decide(payload("Bash", existing)).block, false);
  assert.equal(decide({}).block, false);
});

test("guard resolves relative paths and .. segments", () => {
  const sneaky = path.join(ROOT, "backend", "app", "..", "migrations", "versions", "x.py");
  assert.equal(decide(payload("Edit", sneaky)).block, true);
  const relative = { ...payload("Edit", "versions/x.py"), cwd: path.join(ROOT, "backend", "migrations") };
  assert.equal(decide(relative).block, true);
});

test("guard script exits 2 with a reason for a blocked edit and 0 otherwise", () => {
  const blocked = run("guard-migrations.mjs", payload("Edit", existing));
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /alembic revision --autogenerate/);
  assert.equal(run("guard-migrations.mjs", payload("Edit", path.join(ROOT, "README.md"))).status, 0);
  assert.equal(spawnSync("node", [path.join(HERE, "guard-migrations.mjs")], { input: "not json" }).status, 0);
});

test("guard and ruff follow symlinks", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "hook-links-"));
  const link = path.join(dir, "innocent.py");
  try {
    symlinkSync(existing, link);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    return t.skip(`cannot create symlinks here (${error.code})`);
  }
  try {
    assert.equal(decide(payload("Edit", link)).block, true);
    const backendLink = path.join(ROOT, "backend", "_hook_link_tmp.py");
    symlinkSync(path.join(dir, "outside.py"), backendLink);
    try {
      writeFileSync(path.join(dir, "outside.py"), "x = 1\n");
      assert.equal(targetFor(payload("Edit", backendLink)), null);
    } finally {
      rmSync(backendLink, { force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guard follows a directory link (junction on Windows) into migrations/versions", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hook-junction-"));
  try {
    const viaLink = path.join(dir, "linked");
    symlinkSync(VERSIONS, viaLink, "junction");
    assert.equal(decide(payload("Edit", path.join(viaLink, "bc2cf87d8334_add_equity_curve_to_backtest_results.py"))).block, true);
    // A brand-new file below the linked folder is still a Write into migrations/versions: allowed.
    assert.equal(decide(payload("Write", path.join(viaLink, "0000_new_probe.py"))).block, false);
    assert.equal(decide(payload("Edit", path.join(viaLink, "0000_new_probe.py"))).block, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ruff target is only a .py file under backend, never a migration", () => {
  const py = path.join(ROOT, "backend", "app", "models.py");
  assert.equal(targetFor(payload("Edit", py)), py);
  assert.equal(targetFor(payload("Write", py)), py);
  assert.equal(targetFor(payload("Edit", existing)), null);
  assert.equal(targetFor(payload("Edit", path.join(ROOT, "frontend", "x.py"))), null);
  assert.equal(targetFor(payload("Edit", path.join(ROOT, "backend", "README.md"))), null);
  assert.equal(targetFor(payload("Bash", py)), null);
});

test("ruff hook fixes what it can, and reports what it cannot with exit 2", () => {
  const probe = path.join(ROOT, "backend", "_hook_probe_tmp.py");
  try {
    writeFileSync(probe, "import os\nimport sys\nx = 1\n");
    const fixed = run("ruff-fix.mjs", payload("Write", probe));
    assert.equal(fixed.status, 0, fixed.stderr);
    assert.equal(readFileSync(probe, "utf8"), "x = 1\n");

    writeFileSync(probe, "def f():\n    return undefined_name\n");
    const unfixable = run("ruff-fix.mjs", payload("Edit", probe));
    assert.equal(unfixable.status, 2);
    assert.match(unfixable.stderr, /F821|undefined/);
  } finally {
    if (existsSync(probe)) rmSync(probe);
  }
});
