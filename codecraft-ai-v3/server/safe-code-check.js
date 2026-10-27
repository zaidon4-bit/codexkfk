import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * Read-only code/config syntax checks. `safePath` must enforce the caller's workspace boundary.
 * JavaScript is parsed with `node --check`; the inspected file is never executed.
 */
export async function checkWorkspaceCode(inputPath = "", {
  safePath,
  workspaceRoot,
  maxTextBytes = 300_000,
  nodeExecutable = process.execPath,
  env = {}
} = {}) {
  if (typeof safePath !== "function" || typeof workspaceRoot !== "string" || !workspaceRoot) {
    throw new TypeError("safePath and workspaceRoot are required for workspace code checks.");
  }
  const { target, rel } = await safePath(inputPath, { allowRoot: true, mustExist: true });
  const rootStat = await fs.stat(target);
  const supportedExtensions = new Set([".js", ".mjs", ".cjs", ".json"]);
  const ignoredDirs = new Set(["node_modules", ".git", ".codecraft"]);
  const candidates = [];
  let visitedFiles = 0;
  let truncated = false;

  if (rootStat.isFile()) {
    if (supportedExtensions.has(path.extname(rel).toLowerCase())) candidates.push({ absolutePath: target, relativePath: rel });
  } else if (rootStat.isDirectory()) {
    async function walk(dir, prefix = "", depth = 0) {
      if (depth > 8 || candidates.length >= 30 || visitedFiles >= 800) { truncated = true; return; }
      const entries = await fs.readdir(dir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (candidates.length >= 30 || visitedFiles >= 800) { truncated = true; break; }
        if (entry.name.startsWith(".") || ignoredDirs.has(entry.name) || entry.isSymbolicLink()) continue;
        const absolutePath = path.join(dir, entry.name);
        const relativePath = [prefix, entry.name].filter(Boolean).join("/");
        if (entry.isDirectory()) await walk(absolutePath, relativePath, depth + 1);
        else if (entry.isFile()) {
          visitedFiles++;
          if (supportedExtensions.has(path.extname(entry.name).toLowerCase())) candidates.push({ absolutePath, relativePath });
        }
      }
    }
    await walk(target, rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
  } else {
    throw Object.assign(new Error("Select a file or folder to check."), { status: 400 });
  }

  const results = [];
  for (const file of candidates) {
    try {
      const stat = await fs.stat(file.absolutePath);
      if (stat.size > maxTextBytes) {
        results.push({ path: file.relativePath, status: "skipped", message: `File exceeds the ${Math.round(maxTextBytes / 1000)} KB safe-check limit.` });
        continue;
      }
      if (path.extname(file.relativePath).toLowerCase() === ".json") {
        const source = await fs.readFile(file.absolutePath, "utf8");
        try {
          JSON.parse(source);
          results.push({ path: file.relativePath, status: "passed", kind: "json", message: "Valid JSON." });
        } catch (error) {
          results.push({ path: file.relativePath, status: "failed", kind: "json", message: String(error.message || "Invalid JSON.").slice(0, 500) });
        }
        continue;
      }
      const syntax = await new Promise((resolve, reject) => {
        const safeEnv = { PATH: env.PATH || "", HOME: env.HOME || "", TMPDIR: env.TMPDIR || "/tmp", CI: "1" };
        if (env.SystemRoot) safeEnv.SystemRoot = env.SystemRoot;
        const child = spawn(nodeExecutable, ["--check", file.absolutePath], { cwd: workspaceRoot, env: safeEnv, shell: false, windowsHide: true });
        let output = "";
        const append = chunk => { output += chunk.toString(); if (output.length > 1500) output = output.slice(-1500); };
        child.stdout.on("data", append); child.stderr.on("data", append);
        const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
        child.on("error", error => { clearTimeout(timeout); reject(error); });
        child.on("close", (code, signal) => { clearTimeout(timeout); resolve({ code, signal, output: output.trim() }); });
      });
      results.push({ path: file.relativePath, status: syntax.code === 0 ? "passed" : "failed", kind: "javascript", exitCode: syntax.code, message: syntax.code === 0 ? "Node.js syntax is valid." : (syntax.output || `Syntax check ended with code ${syntax.code ?? "unknown"}.`).slice(0, 1500) });
    } catch (error) {
      results.push({ path: file.relativePath, status: "failed", message: String(error.message || "Syntax check failed.").slice(0, 500) });
    }
  }

  if (!results.length) results.push({ path: rel || ".", status: "skipped", message: "No .js/.mjs/.cjs/.json files found. JSX/TypeScript and full builds require a project build tool." });
  const failed = results.filter(result => result.status === "failed").length;
  return { ok: failed === 0, path: rel || ".", scanned: results.filter(result => result.status !== "skipped").length, failed, skipped: results.filter(result => result.status === "skipped").length, truncated, results };
}
