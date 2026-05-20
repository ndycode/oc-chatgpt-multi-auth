import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function createTempHome() {
	return mkdtemp(join(tmpdir(), "oc-codex-standalone-"));
}

describe("standalone oc-codex-multi-auth CLI commands", () => {
	let tempHome: string | null = null;

	afterEach(async () => {
		vi.restoreAllMocks();
		if (tempHome) {
			await rm(tempHome, { recursive: true, force: true });
			tempHome = null;
		}
	});

	it("runs status as JSON without installer writes", async () => {
		vi.resetModules();
		tempHome = await createTempHome();
		const opencodeDir = join(tempHome, ".opencode");
		await mkdir(opencodeDir, { recursive: true });
		await writeFile(
			join(opencodeDir, "oc-codex-multi-auth-accounts.json"),
			JSON.stringify({
				version: 3,
				activeIndex: 0,
				accounts: [
					{
						accountLabel: "Personal",
						email: "user@example.com",
						accountId: "acct_123456789",
						accountIdSource: "token",
						refreshToken: "refresh-token",
						accessToken: "access-token",
						addedAt: Date.now(),
						lastUsed: Date.now(),
					},
				],
			}, null, 2),
			"utf-8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const { runInstaller } = await import("../scripts/install-oc-codex-multi-auth-core.js");

		await expect(runInstaller(["status", "--json"], {
			env: { ...process.env, HOME: tempHome, USERPROFILE: tempHome },
		})).resolves.toMatchObject({ action: "status", exitCode: 0 });

		const output = JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]));
		expect(output.totalAccounts).toBe(1);
		expect(output.accounts[0].email).toBe("user....com");
	});

	it("rejects unknown positional commands instead of installing", async () => {
		vi.resetModules();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const { runInstaller } = await import("../scripts/install-oc-codex-multi-auth-core.js");

		await expect(runInstaller(["wat"])).rejects.toThrow("Unknown command: wat");
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Commands:"));
	});
});

