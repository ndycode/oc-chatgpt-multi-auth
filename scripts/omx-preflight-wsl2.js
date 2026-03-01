#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PLACEHOLDER_PANE_ID = "replace-with-tmux-pane-id";

const __filename = fileURLToPath(import.meta.url);

function normalizePathForCompare(path) {
  const resolved = resolve(path);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  return normalizePathForCompare(process.argv[1]) === normalizePathForCompare(__filename);
})();

export function parseArgs(argv) {
  const options = {
    json: false,
    distro: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--distro") {
      const value = argv[index + 1] ?? "";
      if (!value) throw new Error("Missing value for --distro");
      options.distro = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${token}`);
  }

  return options;
}

export function runProcess(command, args, overrides = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    ...overrides,
  });

  return {
    code: typeof result.status === "number" ? result.status : 1,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

function addCheck(checks, status, severity, name, detail) {
  checks.push({ status, severity, name, detail });
}

export function parseDistroList(stdout) {
  return stdout
    .replace(/\u0000/g, "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function getShellCommand(toolName) {
  if (process.platform !== "win32") return toolName;
  if (toolName === "npm") return "npm.cmd";
  if (toolName === "npx") return "npx.cmd";
  return toolName;
}

function checkOmxOnHost(checks, runner) {
  const omxHelp = runner(getShellCommand("omx"), ["--help"]);
  if (omxHelp.code === 0) {
    addCheck(checks, "pass", "info", "omx host runtime", "omx is available in current host runtime.");
  } else {
    addCheck(
      checks,
      "fail",
      "fatal",
      "omx host runtime",
      "omx is required for both team mode and fallback mode. Install/enable omx first.",
    );
  }
}

function checkHookConfig(checks, cwd, fsDeps) {
  const hookPath = join(cwd, ".omx", "tmux-hook.json");
  if (!fsDeps.existsSync(hookPath)) {
    addCheck(checks, "warn", "info", "tmux hook config", `${hookPath} not found (optional but recommended).`);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(fsDeps.readFileSync(hookPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addCheck(checks, "fail", "fixable", "tmux hook config parse", `Invalid JSON in ${hookPath}: ${message}`);
    return;
  }

  const target =
    parsed && typeof parsed === "object" && "target" in parsed && parsed.target && typeof parsed.target === "object"
      ? parsed.target
      : null;
  const value = target && "value" in target && typeof target.value === "string" ? target.value : "";
  if (value === PLACEHOLDER_PANE_ID) {
    addCheck(
      checks,
      "fail",
      "fixable",
      "tmux hook pane target",
      `Set .omx/tmux-hook.json target.value to a real pane id (for example %12), not ${PLACEHOLDER_PANE_ID}.`,
    );
    return;
  }
  addCheck(checks, "pass", "info", "tmux hook pane target", "tmux hook target is not placeholder.");
}

function runWindowsChecks(checks, requestedDistro, runner) {
  checkOmxOnHost(checks, runner);

  const wsl = runner("wsl", ["-l", "-q"]);
  if (wsl.code !== 0) {
    addCheck(checks, "fail", "team_hard", "wsl availability", "WSL unavailable. Team mode requires WSL2 or Unix host.");
    return { distro: "" };
  }

  const allDistros = parseDistroList(wsl.stdout);
  if (allDistros.length === 0) {
    addCheck(checks, "fail", "team_hard", "wsl distros", "No WSL distro found.");
    return { distro: "" };
  }

  const usableDistros = allDistros.filter((name) => !/^docker-desktop(-data)?$/i.test(name));
  if (usableDistros.length === 0) {
    addCheck(checks, "fail", "team_hard", "usable distro", "Only Docker Desktop distros found. Install Ubuntu or another Linux distro.");
    return { distro: "" };
  }

  let selectedDistro = usableDistros[0];
  if (requestedDistro) {
    if (!allDistros.includes(requestedDistro)) {
      addCheck(checks, "fail", "team_hard", "requested distro", `Requested distro '${requestedDistro}' not found.`);
      return { distro: "" };
    }
    selectedDistro = requestedDistro;
  }
  addCheck(checks, "pass", "info", "selected distro", `Using WSL distro: ${selectedDistro}`);

  function runInWsl(command) {
    return runner("wsl", ["-d", selectedDistro, "--", "sh", "-lc", command]);
  }

  const tmux = runInWsl("command -v tmux >/dev/null 2>&1");
  if (tmux.code === 0) {
    addCheck(checks, "pass", "info", "tmux in WSL", "tmux is available in selected distro.");
  } else {
    addCheck(checks, "fail", "team_hard", "tmux in WSL", "Install tmux in selected distro.");
  }

  const omx = runInWsl("command -v omx >/dev/null 2>&1");
  if (omx.code === 0) {
    addCheck(checks, "pass", "info", "omx in WSL", "omx is available in selected distro.");
  } else {
    addCheck(checks, "fail", "team_hard", "omx in WSL", "Install/enable omx inside selected distro.");
  }

  const teamHelp = runInWsl("omx team --help >/dev/null 2>&1");
  if (teamHelp.code === 0) {
    addCheck(checks, "pass", "info", "omx team in WSL", "omx team command is callable in selected distro.");
  } else {
    addCheck(checks, "fail", "team_hard", "omx team in WSL", "omx team --help failed in selected distro.");
  }

  const tmuxSession = runInWsl("[ -n \"${TMUX:-}\" ]");
  if (tmuxSession.code === 0) {
    addCheck(checks, "pass", "info", "tmux leader session", "Current WSL shell is inside tmux.");
  } else {
    addCheck(checks, "fail", "fixable", "tmux leader session", "Attach/start tmux in WSL before running omx team.");
  }

  return { distro: selectedDistro };
}

function runUnixChecks(checks, runner) {
  checkOmxOnHost(checks, runner);

  const tmux = runner("sh", ["-lc", "command -v tmux >/dev/null 2>&1"]);
  if (tmux.code === 0) {
    addCheck(checks, "pass", "info", "tmux installed", "tmux is available in current runtime.");
  } else {
    addCheck(checks, "fail", "team_hard", "tmux installed", "Install tmux to use team mode.");
  }

  const teamHelp = runner("sh", ["-lc", "omx team --help >/dev/null 2>&1"]);
  if (teamHelp.code === 0) {
    addCheck(checks, "pass", "info", "omx team help", "omx team command is callable.");
  } else {
    addCheck(checks, "fail", "team_hard", "omx team help", "omx team --help failed in current runtime.");
  }

  const tmuxSession = runner("sh", ["-lc", "[ -n \"${TMUX:-}\" ]"]);
  if (tmuxSession.code === 0) {
    addCheck(checks, "pass", "info", "tmux leader session", "Current shell is inside tmux.");
  } else {
    addCheck(checks, "fail", "fixable", "tmux leader session", "Enter a tmux session before running omx team.");
  }
}

export function decide(checks) {
  const hasFatal = checks.some((entry) => entry.status === "fail" && entry.severity === "fatal");
  const hasTeamHard = checks.some((entry) => entry.status === "fail" && entry.severity === "team_hard");
  const hasFixable = checks.some((entry) => entry.status === "fail" && entry.severity === "fixable");

  if (hasFatal) return { mode: "blocked", exitCode: 4 };
  if (hasTeamHard) return { mode: "fallback_ralph", exitCode: 3 };
  if (hasFixable) return { mode: "team_blocked", exitCode: 2 };
  return { mode: "team_ready", exitCode: 0 };
}

export function formatConsoleOutput(payload) {
  const lines = [];
  lines.push("OMX WSL2 Team Preflight");
  lines.push("=======================");
  lines.push(`Decision: ${payload.mode}`);
  if (payload.distro) lines.push(`Distro: ${payload.distro}`);
  lines.push("");
  lines.push("Checks:");
  for (const check of payload.checks) {
    let label = "PASS";
    if (check.status === "warn") label = "WARN";
    if (check.status === "fail" && check.severity === "fixable") label = "FAIL-FIX";
    if (check.status === "fail" && check.severity === "team_hard") label = "FAIL-TEAM";
    if (check.status === "fail" && check.severity === "fatal") label = "FAIL-FATAL";
    lines.push(`- [${label}] ${check.name}: ${check.detail}`);
  }
  lines.push("");
  if (payload.mode === "team_ready") {
    lines.push("Next: run `omx team ralph 6:executor \"<task>\"` inside tmux.");
  } else if (payload.mode === "team_blocked") {
    lines.push("Next: fix FAIL-FIX checks and rerun preflight.");
  } else if (payload.mode === "fallback_ralph") {
    lines.push("Next: run controlled fallback `omx ralph \"<task>\"` while team prerequisites are unavailable.");
  } else {
    lines.push("Next: fix FAIL-FATAL prerequisites before continuing.");
  }
  return lines.join("\n");
}

export function runPreflight(options = {}, deps = {}) {
  const checks = [];
  const runner = deps.runProcess ?? runProcess;
  const platform = deps.platform ?? process.platform;
  const cwd = deps.cwd ?? process.cwd();
  const fsDeps = {
    existsSync: deps.existsSync ?? existsSync,
    readFileSync: deps.readFileSync ?? readFileSync,
  };

  let distro = "";
  if (platform === "win32") {
    const winResult = runWindowsChecks(checks, options.distro ?? "", runner);
    distro = winResult.distro;
  } else {
    runUnixChecks(checks, runner);
  }

  checkHookConfig(checks, cwd, fsDeps);
  const decision = decide(checks);
  return {
    mode: decision.mode,
    exitCode: decision.exitCode,
    distro,
    checks,
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = runPreflight(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatConsoleOutput(result));
  }
  process.exit(result.exitCode);
}

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error("Preflight failed.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
