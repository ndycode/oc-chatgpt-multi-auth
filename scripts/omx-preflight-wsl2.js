#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { main } from "./omx-preflight-wsl2-core.js";

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
  try {
    main();
  } catch (error) {
    console.error("Preflight failed.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
