#!/usr/bin/env node
/**
 * Build a source-cache.json from the knowledge-graph.json + source directory.
 *
 * Reads file paths from public/knowledge-graph.json, reads actual source
 * from $SOURCE_DIR, and writes public/source-cache.json as a lookup table
 * that the CodeViewer uses in demo/demo mode for static deploys.
 *
 * Usage:
 *   SOURCE_DIR=/path/to/source-repo node scripts/build-source-cache.mjs [graph-json-path]
 *
 * Falls back gracefully: if SOURCE_DIR is not set or files are missing,
 * the cache is empty and the dashboard shows "Source unavailable" for
 * those files — no build failure.
 */

import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { resolve, relative, normalize } from "node:path";

const MAX_SOURCE_FILE_BYTES = 512_000; // 500 KB

function detectLanguage(filePath) {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const byExt = {
    cjs: "javascript",
    cjsx: "jsx",
    css: "css",
    go: "go",
    html: "markup",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    mjs: "javascript",
    md: "markdown",
    mdx: "markdown",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "bash",
    sql: "sql",
    ts: "typescript",
    tsx: "tsx",
    txt: "text",
    yaml: "yaml",
    yml: "yaml",
  };
  return byExt[ext] ?? "text";
}

const sourceDir = process.env.SOURCE_DIR;
if (!sourceDir) {
  console.warn("[source-cache] SOURCE_DIR not set — skipping source cache. Static deploys will show 'Source unavailable'.");
  writeFileSync("public/source-cache.json", "{}");
  process.exit(0);
}

const resolvedSourceDir = resolve(sourceDir);
if (!existsSync(resolvedSourceDir)) {
  console.warn(`[source-cache] SOURCE_DIR '${resolvedSourceDir}' does not exist — skipping.`);
  writeFileSync("public/source-cache.json", "{}");
  process.exit(0);
}

const graphPath = process.argv[2] || "public/knowledge-graph.json";
let graph;
try {
  graph = JSON.parse(readFileSync(graphPath, "utf-8"));
} catch {
  console.error(`[source-cache] Cannot read knowledge graph at '${graphPath}'`);
  writeFileSync("public/source-cache.json", "{}");
  process.exit(1);
}

const filePaths = new Set();
if (Array.isArray(graph.nodes)) {
  for (const node of graph.nodes) {
    if (node.filePath && typeof node.filePath === "string") {
      filePaths.add(node.filePath);
    }
  }
}

console.log(`[source-cache] Found ${filePaths.size} file paths in graph. Reading from ${resolvedSourceDir}...`);

const cache = {};
let bundled = 0;
let skipped = 0;

for (const fp of filePaths) {
  const absolutePath = resolve(resolvedSourceDir, fp);
  // Security: ensure path stays inside source dir
  const rel = relative(resolvedSourceDir, absolutePath);
  if (!rel || rel.startsWith("..") || normalize(rel).startsWith("..")) {
    skipped++;
    continue;
  }

  if (!existsSync(absolutePath)) {
    skipped++;
    continue;
  }

  let stat;
  try { stat = statSync(absolutePath); } catch { skipped++; continue; }
  if (!stat.isFile()) { skipped++; continue; }
  if (stat.size > MAX_SOURCE_FILE_BYTES) { skipped++; continue; }

  let buffer;
  try { buffer = readFileSync(absolutePath); } catch { skipped++; continue; }
  if (buffer.includes(0)) { skipped++; continue; } // binary

  const content = buffer.toString("utf8");
  cache[fp] = {
    path: fp,
    language: detectLanguage(fp),
    content,
    sizeBytes: buffer.byteLength,
    lineCount: content.length === 0 ? 0 : content.split(/\r\n|\n|\r/).length,
  };
  bundled++;
}

writeFileSync("public/source-cache.json", JSON.stringify(cache));
console.log(`[source-cache] Done: ${bundled} files bundled, ${skipped} skipped. Cache: ${(JSON.stringify(cache).length / 1024).toFixed(1)} KB`);
