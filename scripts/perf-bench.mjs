#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
let AccountManager;
let convertSseToJson;
let cleanupToolDefinitions;

const HOTSPOT_SCENARIOS = new Set([
	"selection_degraded_n200",
	"sse_nonstream_large",
	"tool_cleanup_n100",
]);

const DEFAULT_HOTSPOT_TARGET = 0.4;
const DEFAULT_NONHOT_REGRESSION_LIMIT = 0.03;

function parseArgs(argv) {
	const parsed = {
		output: ".omx/perf/current.json",
		baseline: ".omx/perf/baseline.json",
		writeBaseline: false,
		hotspotTarget: DEFAULT_HOTSPOT_TARGET,
		nonHotRegressionLimit: DEFAULT_NONHOT_REGRESSION_LIMIT,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--output" && argv[i + 1]) {
			parsed.output = argv[i + 1];
			i += 1;
			continue;
		}
		if (arg === "--baseline" && argv[i + 1]) {
			parsed.baseline = argv[i + 1];
			i += 1;
			continue;
		}
		if (arg === "--gate-hotspot" && argv[i + 1]) {
			parsed.hotspotTarget = Number(argv[i + 1]);
			i += 1;
			continue;
		}
		if (arg === "--gate-nonhot" && argv[i + 1]) {
			parsed.nonHotRegressionLimit = Number(argv[i + 1]);
			i += 1;
			continue;
		}
		if (arg === "--write-baseline") {
			parsed.writeBaseline = true;
		}
	}

	return parsed;
}

function percentile(sortedValues, percentileValue) {
	if (sortedValues.length === 0) return 0;
	if (sortedValues.length === 1) return sortedValues[0] ?? 0;
	const index = Math.min(
		sortedValues.length - 1,
		Math.max(0, Math.ceil((percentileValue / 100) * sortedValues.length) - 1),
	);
	return sortedValues[index] ?? 0;
}

function summarize(values) {
	if (values.length === 0) {
		return {
			min: 0,
			max: 0,
			mean: 0,
			p50: 0,
			p95: 0,
			p99: 0,
		};
	}
	const sorted = [...values].sort((a, b) => a - b);
	const total = sorted.reduce((sum, value) => sum + value, 0);
	return {
		min: sorted[0] ?? 0,
		max: sorted[sorted.length - 1] ?? 0,
		mean: total / sorted.length,
		p50: percentile(sorted, 50),
		p95: percentile(sorted, 95),
		p99: percentile(sorted, 99),
	};
}

function ensureParentDir(path) {
	const parent = dirname(path);
	if (!existsSync(parent)) {
		mkdirSync(parent, { recursive: true });
	}
}

function toAccountStorage(count) {
	const now = Date.now();
	return {
		version: 3,
		activeIndex: 0,
		activeIndexByFamily: {},
		accounts: Array.from({ length: count }, (_, index) => ({
			accountId: `acct-${index}`,
			organizationId: `org-${Math.floor(index / 4)}`,
			accountIdSource: "token",
			accountLabel: `bench-${index}`,
			email: `bench-${index}@example.com`,
			refreshToken: `refresh-${index}`,
			accessToken: `access-${index}`,
			expiresAt: now + 60 * 60 * 1000,
			enabled: true,
			addedAt: now - index * 1000,
			lastUsed: now - index * 3000,
			rateLimitResetTimes: {},
		})),
	};
}

function runSelectionTraversal(count, rounds) {
	for (let round = 0; round < rounds; round += 1) {
		const manager = new AccountManager(undefined, toAccountStorage(count));
		const attempted = new Set();
		while (attempted.size < Math.max(1, manager.getAccountCount())) {
			let selected = null;
			if (typeof manager.getSelectionExplainabilityAndNextForFamilyHybrid === "function") {
				const selection = manager.getSelectionExplainabilityAndNextForFamilyHybrid(
					"codex",
					"gpt-5-codex",
					Date.now(),
					{ pidOffsetEnabled: false },
				);
				selected = selection?.account ?? null;
			} else {
				manager.getSelectionExplainability("codex", "gpt-5-codex", Date.now());
				selected = manager.getCurrentOrNextForFamilyHybrid("codex", "gpt-5-codex", {
					pidOffsetEnabled: false,
				});
			}
			if (!selected || attempted.has(selected.index)) break;
			attempted.add(selected.index);
			manager.markAccountCoolingDown(selected, 120_000, "auth-failure");
			manager.recordFailure(selected, "codex", "gpt-5-codex");
		}
	}
}

function createLargeSsePayload(deltaEvents) {
	const parts = [];
	for (let i = 0; i < deltaEvents; i += 1) {
		parts.push(
			`data: {"type":"response.output_text.delta","delta":"chunk-${i}-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}\n\n`,
		);
	}
	parts.push(
		`data: {"type":"response.done","response":{"id":"resp-bench","object":"response","model":"gpt-5-codex","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}]}}\n\n`,
	);
	parts.push("data: [DONE]\n\n");
	return parts.join("");
}

function streamFromString(value, chunkSize) {
	const encoder = new TextEncoder();
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset >= value.length) {
				controller.close();
				return;
			}
			const chunk = value.slice(offset, offset + chunkSize);
			offset += chunkSize;
			controller.enqueue(encoder.encode(chunk));
		},
	});
}

async function runSseConversion(deltaEvents, chunkSize, rounds) {
	const payload = createLargeSsePayload(deltaEvents);
	for (let i = 0; i < rounds; i += 1) {
		const response = new Response(streamFromString(payload, chunkSize), {
			headers: {
				"content-type": "text/event-stream",
			},
		});
		const converted = await convertSseToJson(response, new Headers(response.headers), {
			streamStallTimeoutMs: 20_000,
		});
		await converted.text();
	}
}

function createToolFixture(toolCount) {
	const tools = [];
	for (let i = 0; i < toolCount; i += 1) {
		tools.push({
			type: "function",
			function: {
				name: `bench_tool_${i}`,
				description: "Synthetic benchmark tool",
				parameters: {
					type: "object",
					required: ["mode", "level", "phantom"],
					properties: {
						mode: {
							anyOf: [{ const: "fast" }, { const: "safe" }, { const: "balanced" }],
						},
						level: {
							type: ["string", "null"],
							description: "level",
						},
						payload: {
							type: "object",
							properties: {
								seed: { type: "number" },
								values: {
									type: "array",
									items: {
										type: ["string", "null"],
										description: "nested",
									},
								},
							},
							additionalProperties: true,
						},
					},
					additionalProperties: true,
				},
			},
		});
	}
	return tools;
}

function runToolCleanup(toolCount, rounds) {
	const tools = createToolFixture(toolCount);
	for (let i = 0; i < rounds; i += 1) {
		cleanupToolDefinitions(tools);
	}
}

async function benchmarkScenario(config) {
	const durations = [];
	const heapDeltas = [];
	const monitor = monitorEventLoopDelay({ resolution: 20 });
	monitor.enable();

	for (let i = 0; i < config.warmup; i += 1) {
		await config.run();
	}

	for (let i = 0; i < config.iterations; i += 1) {
		const heapBefore = process.memoryUsage().heapUsed;
		const started = performance.now();
		await config.run();
		const elapsed = performance.now() - started;
		const heapAfter = process.memoryUsage().heapUsed;
		durations.push(elapsed);
		heapDeltas.push(heapAfter - heapBefore);
	}

	monitor.disable();
	const latency = summarize(durations);
	const heap = summarize(heapDeltas);
	return {
		name: config.name,
		category: HOTSPOT_SCENARIOS.has(config.name) ? "hotspot" : "nonhot",
		iterations: config.iterations,
		warmup: config.warmup,
		latencyMs: latency,
		heapDeltaBytes: heap,
		eventLoopDelayMeanMs: Number.isFinite(monitor.mean) ? monitor.mean / 1_000_000 : 0,
	};
}

function toScenarioMap(scenarios) {
	const map = new Map();
	for (const scenario of scenarios) {
		map.set(scenario.name, scenario);
	}
	return map;
}

function evaluateGate(currentRun, baselineRun, hotspotTarget, nonHotRegressionLimit) {
	if (!baselineRun) {
		return {
			passed: true,
			reason: "no-baseline",
			details: [],
		};
	}

	const baselineByName = toScenarioMap(baselineRun.scenarios);
	const details = [];
	let passed = true;

	for (const currentScenario of currentRun.scenarios) {
		const baselineScenario = baselineByName.get(currentScenario.name);
		if (!baselineScenario) {
			passed = false;
			details.push({
				name: currentScenario.name,
				status: "missing-baseline-scenario",
			});
			continue;
		}

		const baseP95 = baselineScenario.latencyMs.p95;
		const currP95 = currentScenario.latencyMs.p95;
		const improvement = baseP95 > 0 ? (baseP95 - currP95) / baseP95 : 0;
		const regression = baseP95 > 0 ? (currP95 - baseP95) / baseP95 : 0;
		const isHotspot = currentScenario.category === "hotspot";

		if (isHotspot) {
			const ok = improvement >= hotspotTarget;
			if (!ok) passed = false;
			details.push({
				name: currentScenario.name,
				status: ok ? "pass" : "fail",
				requirement: `improvement>=${Math.round(hotspotTarget * 100)}%`,
				improvementPct: Number((improvement * 100).toFixed(2)),
				baselineP95Ms: Number(baseP95.toFixed(3)),
				currentP95Ms: Number(currP95.toFixed(3)),
			});
			continue;
		}

		const ok = regression <= nonHotRegressionLimit;
		if (!ok) passed = false;
		details.push({
			name: currentScenario.name,
			status: ok ? "pass" : "fail",
			requirement: `regression<=${Math.round(nonHotRegressionLimit * 100)}%`,
			regressionPct: Number((regression * 100).toFixed(2)),
			baselineP95Ms: Number(baseP95.toFixed(3)),
			currentP95Ms: Number(currP95.toFixed(3)),
		});
	}

	return {
		passed,
		reason: passed ? "thresholds-satisfied" : "thresholds-failed",
		details,
	};
}

function safeReadJson(path) {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function getGitCommit() {
	try {
		return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
	} catch {
		return "unknown";
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	if (!existsSync(resolve("dist/lib/accounts.js"))) {
		console.error("dist build artifacts not found. Run `npm run build` first.");
		process.exit(1);
	}

	({ AccountManager } = await import("../dist/lib/accounts.js"));
	({ convertSseToJson } = await import("../dist/lib/request/response-handler.js"));
	({ cleanupToolDefinitions } = await import("../dist/lib/request/helpers/tool-utils.js"));

	const scenarios = [
		await benchmarkScenario({
			name: "selection_degraded_n50",
			iterations: 20,
			warmup: 4,
			run: () => runSelectionTraversal(50, 12),
		}),
		await benchmarkScenario({
			name: "selection_degraded_n200",
			iterations: 20,
			warmup: 4,
			run: () => runSelectionTraversal(200, 10),
		}),
		await benchmarkScenario({
			name: "sse_nonstream_small",
			iterations: 16,
			warmup: 3,
			run: () => runSseConversion(80, 2048, 2),
		}),
		await benchmarkScenario({
			name: "sse_nonstream_large",
			iterations: 16,
			warmup: 3,
			run: () => runSseConversion(1600, 512, 1),
		}),
		await benchmarkScenario({
			name: "tool_cleanup_n25",
			iterations: 30,
			warmup: 4,
			run: () => runToolCleanup(25, 10),
		}),
		await benchmarkScenario({
			name: "tool_cleanup_n100",
			iterations: 25,
			warmup: 4,
			run: () => runToolCleanup(100, 8),
		}),
	];

	const baselinePath = resolve(args.baseline);
	const outputPath = resolve(args.output);
	const baselineRun = args.writeBaseline ? null : safeReadJson(baselinePath);
	const run = {
		meta: {
			timestamp: new Date().toISOString(),
			commit: getGitCommit(),
			node: process.version,
			platform: process.platform,
			arch: process.arch,
		},
		thresholds: {
			hotspotImprovementRequired: args.hotspotTarget,
			nonHotRegressionAllowed: args.nonHotRegressionLimit,
		},
		scenarios,
	};
	run.gate = evaluateGate(
		run,
		baselineRun,
		args.hotspotTarget,
		args.nonHotRegressionLimit,
	);

	ensureParentDir(outputPath);
	writeFileSync(outputPath, JSON.stringify(run, null, 2), "utf8");
	console.log(`Performance benchmark written to ${outputPath}`);

	if (args.writeBaseline) {
		ensureParentDir(baselinePath);
		writeFileSync(baselinePath, JSON.stringify(run, null, 2), "utf8");
		console.log(`Baseline captured at ${baselinePath}`);
		return;
	}

	console.log(`Gate status: ${run.gate.passed ? "PASS" : "FAIL"} (${run.gate.reason})`);
	for (const detail of run.gate.details) {
		console.log(JSON.stringify(detail));
	}
	if (!run.gate.passed) {
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
