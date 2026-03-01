import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("omx-capture-evidence script", () => {
  it("parses required args", async () => {
    const mod = await import("../scripts/omx-capture-evidence.js");
    expect(
      mod.parseArgs([
        "--mode",
        "ralph",
        "--architect-tier",
        "standard",
        "--architect-ref",
        "architect://run/123",
      ]),
    ).toEqual({
      mode: "ralph",
      team: "",
      architectTier: "standard",
      architectRef: "architect://run/123",
      architectNote: "",
      output: "",
    });
  });

  it("requires architect args", async () => {
    const mod = await import("../scripts/omx-capture-evidence.js");
    expect(() => mod.parseArgs(["--mode", "ralph"])).toThrow("`--architect-tier` is required.");
  });

  it("parses team status counts from json and text", async () => {
    const mod = await import("../scripts/omx-capture-evidence.js");
    expect(mod.parseTeamCounts('{"task_counts":{"pending":0,"in_progress":0,"failed":1}}')).toEqual({
      pending: 0,
      inProgress: 0,
      failed: 1,
    });
    expect(mod.parseTeamCounts("pending=2 in_progress=1 failed=0")).toEqual({
      pending: 2,
      inProgress: 1,
      failed: 0,
    });
  });

  it("writes evidence markdown when gates pass in ralph mode", async () => {
    const mod = await import("../scripts/omx-capture-evidence.js");
    const root = await mkdtemp(join(tmpdir(), "omx-evidence-"));
    await writeFile(join(root, "package.json"), '{"name":"tmp"}', "utf8");

    try {
      const outputPath = join(root, ".omx", "evidence", "result.md");
      const result = mod.runEvidence(
        {
          mode: "ralph",
          team: "",
          architectTier: "standard",
          architectRef: "architect://verdict/ok",
          architectNote: "approved",
          output: outputPath,
        },
        {
          cwd: root,
          runCommand: (command: string, args: string[]) => {
            if (command === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
              return { command: "git rev-parse --abbrev-ref HEAD", code: 0, stdout: "feature/test", stderr: "" };
            }
            if (command === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
              return { command: "git rev-parse HEAD", code: 0, stdout: "abc123", stderr: "" };
            }
            return { command: `${command} ${args.join(" ")}`, code: 0, stdout: "ok", stderr: "" };
          },
        },
      );

      expect(result.overallPassed).toBe(true);
      const markdown = await readFile(outputPath, "utf8");
      expect(markdown).toContain("## Overall Result: PASS");
      expect(markdown).toContain("architect://verdict/ok");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails ralph mode evidence when cleanup state is still active", async () => {
    const mod = await import("../scripts/omx-capture-evidence.js");
    const root = await mkdtemp(join(tmpdir(), "omx-evidence-active-"));
    await writeFile(join(root, "package.json"), '{"name":"tmp"}', "utf8");
    await mkdir(join(root, ".omx", "state"), { recursive: true });
    await writeFile(
      join(root, ".omx", "state", "ralph-state.json"),
      JSON.stringify({ active: true, current_phase: "executing" }),
      "utf8",
    );

    try {
      const outputPath = join(root, ".omx", "evidence", "result-active.md");
      const result = mod.runEvidence(
        {
          mode: "ralph",
          team: "",
          architectTier: "standard",
          architectRef: "architect://verdict/ok",
          architectNote: "",
          output: outputPath,
        },
        {
          cwd: root,
          runCommand: (command: string, args: string[]) => {
            if (command === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
              return { command: "git rev-parse --abbrev-ref HEAD", code: 0, stdout: "feature/test", stderr: "" };
            }
            if (command === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
              return { command: "git rev-parse HEAD", code: 0, stdout: "abc123", stderr: "" };
            }
            return { command: `${command} ${args.join(" ")}`, code: 0, stdout: "ok", stderr: "" };
          },
        },
      );

      expect(result.overallPassed).toBe(false);
      const markdown = await readFile(outputPath, "utf8");
      expect(markdown).toContain("Ralph cleanup state");
      expect(markdown).toContain("FAIL");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
