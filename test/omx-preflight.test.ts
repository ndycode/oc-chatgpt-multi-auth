import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("omx-preflight-wsl2 script", () => {
  it("parses cli args", async () => {
    const mod = await import("../scripts/omx-preflight-wsl2.js");
    expect(mod.parseArgs(["--json", "--distro", "Ubuntu"])).toEqual({
      json: true,
      distro: "Ubuntu",
    });
  });

  it("throws on unknown args", async () => {
    const mod = await import("../scripts/omx-preflight-wsl2.js");
    expect(() => mod.parseArgs(["--wat"])).toThrow("Unknown option");
  });

  it("normalizes WSL distro output that contains null chars", async () => {
    const mod = await import("../scripts/omx-preflight-wsl2.js");
    const output = "d\u0000o\u0000c\u0000k\u0000e\u0000r\u0000-\u0000d\u0000e\u0000s\u0000k\u0000t\u0000o\u0000p\u0000\r\n\u0000Ubuntu\r\n";
    expect(mod.parseDistroList(output)).toEqual(["docker-desktop", "Ubuntu"]);
  });

  it("warns on missing host omx in windows mode when WSL checks pass", async () => {
    const mod = await import("../scripts/omx-preflight-wsl2.js");

    const result = mod.runPreflight(
      { distro: "" },
      {
        platform: "win32",
        cwd: process.cwd(),
        existsSync: () => false,
        readFileSync: () => "",
        runProcess: (command: string, args: string[]) => {
          if (command === "omx") return { code: 1, stdout: "", stderr: "missing" };
          if (command === "wsl" && args[0] === "-l") return { code: 0, stdout: "Ubuntu\n", stderr: "" };
          if (command === "wsl" && args[0] === "-d") return { code: 0, stdout: "", stderr: "" };
          return { code: 0, stdout: "", stderr: "" };
        },
      },
    );

    expect(result.mode).toBe("team_ready");
    expect(result.exitCode).toBe(0);
    expect(result.checks.some((entry: { name: string; status: string }) => entry.name === "omx host runtime" && entry.status === "warn")).toBe(true);
  });

  it("routes to blocked when omx is missing on unix host", async () => {
    const mod = await import("../scripts/omx-preflight-wsl2.js");

    const result = mod.runPreflight(
      { distro: "" },
      {
        platform: "linux",
        cwd: process.cwd(),
        existsSync: () => false,
        readFileSync: () => "",
        runProcess: (command: string) => {
          if (command === "omx") return { code: 1, stdout: "", stderr: "missing" };
          return { code: 0, stdout: "", stderr: "" };
        },
      },
    );

    expect(result.mode).toBe("blocked");
    expect(result.exitCode).toBe(4);
  });

  it("routes to fallback when team-only prerequisites fail", async () => {
    const mod = await import("../scripts/omx-preflight-wsl2.js");

    const result = mod.runPreflight(
      { distro: "" },
      {
        platform: "win32",
        cwd: process.cwd(),
        existsSync: () => false,
        readFileSync: () => "",
        runProcess: (command: string, args: string[]) => {
          if (command === "omx") return { code: 0, stdout: "ok", stderr: "" };
          if (command === "wsl" && args[0] === "-l") return { code: 0, stdout: "docker-desktop\n", stderr: "" };
          return { code: 0, stdout: "", stderr: "" };
        },
      },
    );

    expect(result.mode).toBe("fallback_ralph");
    expect(result.exitCode).toBe(3);
  });

  it("detects placeholder tmux hook pane target as fixable", async () => {
    const mod = await import("../scripts/omx-preflight-wsl2.js");
    const root = await mkdtemp(join(tmpdir(), "omx-preflight-"));
    const omxDir = join(root, ".omx");
    await mkdir(omxDir, { recursive: true });
    await writeFile(
      join(omxDir, "tmux-hook.json"),
      JSON.stringify({
        enabled: true,
        target: { type: "pane", value: "replace-with-tmux-pane-id" },
      }),
      "utf8",
    );

    try {
      const result = mod.runPreflight(
        { distro: "" },
        {
          platform: "linux",
          cwd: root,
          runProcess: (command: string, args: string[]) => {
            if (command === "sh" && args.join(" ").includes("command -v tmux")) return { code: 0, stdout: "", stderr: "" };
            if (command === "sh" && args.join(" ").includes("omx team --help")) return { code: 0, stdout: "", stderr: "" };
            if (command === "sh" && args.join(" ").includes("${TMUX:-}")) return { code: 0, stdout: "", stderr: "" };
            if (command === "omx") return { code: 0, stdout: "ok", stderr: "" };
            return { code: 0, stdout: "", stderr: "" };
          },
        },
      );

      expect(result.mode).toBe("team_blocked");
      expect(result.checks.some((entry: { name: string; status: string }) => entry.name === "tmux hook pane target" && entry.status === "fail")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
