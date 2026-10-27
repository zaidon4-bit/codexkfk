import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const envExample = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test("agent declares exactly the eight implemented workspace tools", () => {
  const block = server.match(/const AGENT_TOOLS = \[(.*?)\n\];/s)?.[1];
  assert.ok(block, "AGENT_TOOLS definition should exist");
  const names = [...block.matchAll(/name: "([a-z_]+)"/g)].map(match => match[1]);
  assert.deepEqual(names, ["list_files", "read_file", "search_files", "check_code", "write_file", "delete_file", "run_command", "create_task"]);
});

test("mutating and command tools require an approval checkpoint", () => {
  assert.match(server, /const approvalTools = new Set\(\["write_file", "delete_file", "run_command", "create_task"\]\)/);
  assert.match(server, /ENABLE_WORKSPACE_COMMANDS !== "true"/);
  assert.match(server, /req\.body\?\.confirmed !== true/);
  assert.match(server, /const commandMap = \{/);
  for (const alias of ["build", "test", "lint", "typecheck", "git-status", "git-diff-check"]) assert.ok(server.includes(`"${alias}"`), `missing command alias ${alias}`);
  assert.match(envExample, /ENABLE_WORKSPACE_COMMANDS=false/);
});

test("command runner is gated by explicit confirmation, safe aliases and npm script preflight", () => {
  assert.match(server, /async function commandPreflight\(name\)/);
  assert.match(server, /does not define scripts\.\$\{scriptName\}/);
  assert.match(ui, /window\.confirm\(`Approve running/);
  assert.match(envExample, /does not implement an OS\/container sandbox/);
});

test("new text writes reject NUL bytes and diagnostics expose reasoning evidence", () => {
  assert.match(server, /Binary content \(NUL byte\) cannot be written through the text-file tool/);
  assert.match(server, /classifyReasoningUsage\(reasoningTokens\)/);
  assert.match(server, /reasoningVerification/);
  assert.match(server, /MAX_TEXT_BYTES \+ 1/);
  assert.match(server, /symbolicLinkRejected/);
  assert.match(server, /traversalRejected/);
  assert.match(ui, /evidence: \$\{item\.reasoningVerification\.evidence\}/);
});

test("diagnostics are authenticated API requests and check local tools plus provider capability", () => {
  assert.match(server, /app\.post\("\/api\/diagnostics\/run"/);
  for (const marker of ["check_code", "basic_chat", "function_calling", "thinking_low", "thinking_medium", "thinking_high", "thinking_xhigh", "deep_analysis_mode", "long_response_mode"]) {
    assert.ok(server.includes(marker), `missing diagnostic check: ${marker}`);
  }
  assert.match(server, /"web_search"[\s\S]*"not_implemented"/);
  assert.match(server, /"mcp_servers"[\s\S]*"not_implemented"/);
  assert.match(server, /"lsp_diagnostics"[\s\S]*"not_implemented"/);
  for (const marker of ["workspace_path_traversal", "NUL_byte_write_rejected", "binary_file_rejected", "300KB_file_limit", "symlink_rejected", "npm_script_preflight"]) assert.ok(server.includes(marker), `missing local diagnostic ${marker}`);
});

test("UI shows actual tool traces and an explicit diagnostic runner", () => {
  assert.match(ui, /TOOLS USED IN THIS TURN/);
  assert.match(ui, /Run full diagnostics/);
  assert.match(ui, /git-diff-check/);
  assert.match(ui, /Reasoning mode · Thinking level/);
  assert.match(styles, /\.tool-trace/);
  assert.match(styles, /\.diagnostic-results/);
});
