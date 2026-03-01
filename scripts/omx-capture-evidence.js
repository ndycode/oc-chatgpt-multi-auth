#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { main } from "./omx-capture-evidence-core.js";

function normalizePathForCompare(path) {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  const currentFile = fileURLToPath(import.meta.url);
  return normalizePathForCompare(process.argv[1]) === normalizePathForCompare(currentFile);
})();

if (isDirectRun) {
  main().catch((error) => {
    console.error("Failed to capture evidence.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
