import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkWorkspaceCode } from "../server/safe-code-check.js";

async function makeSafePath(root) {
  return async function safePath(input, { allowRoot = false, mustExist = false } = {}) {
    const normalized = input === "" && allowRoot ? "" : String(input || "").replace(/\\/g, "/").trim();
    if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized) || normalized.split("/").some(part => part === ".." || part === ".")) {
      throw new Error("Path must stay inside the test workspace.");
    }
    const target = path.resolve(root, normalized);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error("Path outside test workspace.");
    if (mustExist) await fs.access(target);
    return { target, rel: path.relative(root, target).split(path.sep).join("/") };
  };
}

test("safe code check parses JavaScript and JSON without executing source files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codecraft-safe-check-"));
  try {
    await fs.writeFile(path.join(root, "valid.js"), 'import fs from "node:fs";\nfs.writeFileSync("should-not-exist", "executed");\n', "utf8");
    await fs.writeFile(path.join(root, "broken.js"), "const = ;\n", "utf8");
    await fs.writeFile(path.join(root, "valid.json"), '{"ok":true}\n', "utf8");
    await fs.writeFile(path.join(root, "broken.json"), '{"ok":}\n', "utf8");
    const result = await checkWorkspaceCode("", {
      safePath: await makeSafePath(root),
      workspaceRoot: root,
      env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "", TMPDIR: os.tmpdir() }
    });
    const byPath = Object.fromEntries(result.results.map(item => [item.path, item.status]));
    assert.equal(result.scanned, 4);
    assert.equal(result.failed, 2);
    assert.equal(result.ok, false);
    assert.equal(byPath["valid.js"], "passed");
    assert.equal(byPath["broken.js"], "failed");
    assert.equal(byPath["valid.json"], "passed");
    assert.equal(byPath["broken.json"], "failed");
    await assert.rejects(fs.access(path.join(root, "should-not-exist")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("safe code check clearly skips JSX and TypeScript rather than claiming to validate them", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codecraft-safe-check-"));
  try {
    await fs.writeFile(path.join(root, "component.jsx"), "export default () => <div />;\n", "utf8");
    const result = await checkWorkspaceCode("component.jsx", {
      safePath: await makeSafePath(root), workspaceRoot: root,
      env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "", TMPDIR: os.tmpdir() }
    });
    assert.equal(result.scanned, 0);
    assert.equal(result.skipped, 1);
    assert.match(result.results[0].message, /JSX\/TypeScript/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
