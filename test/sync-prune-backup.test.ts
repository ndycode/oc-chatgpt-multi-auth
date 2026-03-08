import { describe, expect, it } from "vitest";
import { createSyncPruneBackupPayload } from "../lib/sync-prune-backup.js";
import type { AccountStorageV3 } from "../lib/storage.js";

describe("sync prune backup payload", () => {
	it("omits access tokens from the prune backup payload", () => {
		const storage: AccountStorageV3 = {
			version: 3,
			activeIndex: 0,
			activeIndexByFamily: {},
			accounts: [
				{
					accountId: "org-sync",
					organizationId: "org-sync",
					accountIdSource: "org",
					refreshToken: "refresh-token",
					accessToken: "access-token",
					addedAt: 1,
					lastUsed: 1,
				},
			],
		};
		const payload = createSyncPruneBackupPayload(storage, {
			version: 1,
			accounts: [
				{
					refreshToken: "refresh-token",
					accessToken: "flagged-access-token",
				},
			],
		});

		expect(payload.accounts.accounts[0]).not.toHaveProperty("accessToken");
		expect(payload.flagged.accounts[0]).not.toHaveProperty("accessToken");
	});
});
