/**
 * Unit tests for OAuth server logic
 * Tests request handling without actual port binding
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";

type MockServer = EventEmitter & {
	_handler?: (req: IncomingMessage, res: ServerResponse) => void;
	listen: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	unref: ReturnType<typeof vi.fn>;
	address: ReturnType<typeof vi.fn>;
	_port?: number;
	_resolvedPort?: number;
};

const listenBehaviors: Array<(server: MockServer, port: number) => void> = [];
const createdServers: MockServer[] = [];

const queueListenBehavior = (behavior: (server: MockServer, port: number) => void) => {
	listenBehaviors.push(behavior);
};

const getLastServer = (): MockServer => {
	const server = createdServers[createdServers.length - 1];
	if (!server) {
		throw new Error("No mock server instances recorded");
	}
	return server;
};

function createMockServer(handler: (req: IncomingMessage, res: ServerResponse) => void): MockServer {
	const server = new EventEmitter() as MockServer;
	server._handler = handler;
	server.listen = vi.fn((port: number) => {
		server._port = typeof port === "number" ? port : 0;
		const behavior = listenBehaviors.shift();
		if (behavior) {
			behavior(server, server._port);
		} else {
			server.emit("listening");
		}
		return server;
	});
	server.close = vi.fn();
	server.unref = vi.fn();
	server.address = vi.fn(() => ({
		port: typeof server._resolvedPort === "number" ? server._resolvedPort : server._port ?? 0,
	}));
	return server;
}

vi.mock("node:http", () => {
	const createServer = vi.fn((handler: (req: IncomingMessage, res: ServerResponse) => void) => {
		const server = createMockServer(handler);
		createdServers.push(server);
		return server;
	});
	return {
		default: {
			createServer,
		},
	};
});

vi.mock("node:fs", () => ({
	default: {
		readFileSync: vi.fn(() => "<html>Success</html>"),
	},
}));

vi.mock("../lib/logger.js", () => ({
	logError: vi.fn(),
	logWarn: vi.fn(),
}));

import { startLocalOAuthServer } from "../lib/auth/server.js";
import { logError, logWarn } from "../lib/logger.js";

type MockResponse = ServerResponse & { _body: string; _headers: Record<string, string> };

function createMockRequest(url: string, method: string = "GET"): IncomingMessage {
	const req = new EventEmitter() as IncomingMessage;
	req.url = url;
	req.method = method;
	return req;
}

function createMockResponse(): MockResponse {
	const res = {
		statusCode: 200,
		_body: "",
		_headers: {} as Record<string, string>,
		setHeader: vi.fn((name: string, value: string) => {
			res._headers[name.toLowerCase()] = value;
		}),
		end: vi.fn((body?: string) => {
			if (body) res._body = body;
		}),
	};

	return res as unknown as MockResponse;
}

describe("OAuth Server Unit Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listenBehaviors.length = 0;
		createdServers.length = 0;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("server creation", () => {
		it("should call http.createServer", async () => {
			queueListenBehavior((server) => {
				server.emit("listening");
			});
			const result = await startLocalOAuthServer({ state: "test-state" });
			expect(result.port).toBe(1455);
			expect(result.ready).toBe(true);
		});

		it("should fall back when initial port binding fails", async () => {
			queueListenBehavior((server) => {
				const error = new Error("Address in use") as NodeJS.ErrnoException;
				error.code = "EADDRINUSE";
				server.emit("error", error);
			});
			queueListenBehavior((server) => {
				server.emit("listening");
			});
			const result = await startLocalOAuthServer({ state: "test-state" });
			expect(result.ready).toBe(true);
			expect(result.port).toBe(14556);
			expect(logError).toHaveBeenCalledWith(
				expect.stringContaining("Failed to bind http://127.0.0.1:1455"),
			);
		});

		it("should surface error metadata when all ports fail", async () => {
			const pushError = (code: string) =>
				queueListenBehavior((server) => {
					const error = new Error(code) as NodeJS.ErrnoException;
					error.code = code;
					server.emit("error", error);
				});
			pushError("EADDRINUSE");
			pushError("EADDRINUSE");
			pushError("EACCES");
			const result = await startLocalOAuthServer({ state: "test-state" });
			expect(result.ready).toBe(false);
			expect(result.errorCode).toBe("EACCES");
			expect(result.errorMessage).toContain("EACCES");
			expect(logError).toHaveBeenCalledTimes(3);
		});
	});

	describe("request handler", () => {
		let requestHandler: (req: IncomingMessage, res: ServerResponse) => void;

		beforeEach(async () => {
			queueListenBehavior((server) => server.emit("listening"));
			await startLocalOAuthServer({ state: "test-state" });
			requestHandler = getLastServer()._handler!;
		});

		it("should return 404 for non-callback paths", () => {
			const req = createMockRequest("/other-path");
			const res = createMockResponse();
			requestHandler(req, res);
			expect(res.statusCode).toBe(404);
			expect(res.end).toHaveBeenCalledWith("Not found");
		});

		it("should return 405 for non-GET methods", () => {
			const req = createMockRequest("/auth/callback?code=abc&state=test-state", "POST");
			const res = createMockResponse();
			requestHandler(req, res);
			expect(res.statusCode).toBe(405);
			expect(res.setHeader).toHaveBeenCalledWith("Allow", "GET");
			expect(res.end).toHaveBeenCalledWith("Method not allowed");
		});

		it("should return 400 for state mismatch", () => {
			const req = createMockRequest("/auth/callback?code=abc&state=wrong-state");
			const res = createMockResponse();
			requestHandler(req, res);
			expect(res.statusCode).toBe(400);
			expect(res.end).toHaveBeenCalledWith("State mismatch");
		});

		it("should return 400 for missing code", () => {
			const req = createMockRequest("/auth/callback?state=test-state");
			const res = createMockResponse();
			requestHandler(req, res);
			expect(res.statusCode).toBe(400);
			expect(res.end).toHaveBeenCalledWith("Missing authorization code");
		});

		it("should return 200 with HTML for valid callback", () => {
			const req = createMockRequest("/auth/callback?code=test-code&state=test-state");
			const res = createMockResponse();
			requestHandler(req, res);
			expect(res.statusCode).toBe(200);
			expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/html; charset=utf-8");
			expect(res.setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
			expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
			expect(res.setHeader).toHaveBeenCalledWith(
				"Content-Security-Policy",
				"default-src 'self'; script-src 'none'",
			);
			expect(res.end).toHaveBeenCalledWith("<html>Success</html>");
		});

		it("should handle request handler errors gracefully", () => {
			const req = createMockRequest("/auth/callback?code=test&state=test-state");
			const res = createMockResponse();
			(res.setHeader as ReturnType<typeof vi.fn>).mockImplementation(() => {
				throw new Error("setHeader failed");
			});
			expect(() => requestHandler(req, res)).not.toThrow();
			expect(res.statusCode).toBe(500);
			expect(res.end).toHaveBeenCalledWith("Internal error");
			expect(logError).toHaveBeenCalledWith(expect.stringContaining("Request handler error"));
		});
	});

	describe("close function", () => {
		it("should call server.close when ready=true", async () => {
			queueListenBehavior((server) => server.emit("listening"));
			const result = await startLocalOAuthServer({ state: "test-state" });
			const server = getLastServer();
			result.close();
			expect(server.close).toHaveBeenCalled();
		});

		it("should ignore close errors", async () => {
			queueListenBehavior((server) => server.emit("listening"));
			const result = await startLocalOAuthServer({ state: "test-state" });
			const server = getLastServer();
			(server.close as ReturnType<typeof vi.fn>).mockImplementation(() => {
				throw new Error("Close failed");
			});
			expect(() => result.close()).not.toThrow();
			expect(logError).toHaveBeenCalledWith(
				expect.stringContaining("Failed to close OAuth server"),
			);
		});
	});

	describe("waitForCode function", () => {
		it("should return null immediately when ready=false", async () => {
			const pushError = () =>
				queueListenBehavior((server) => {
					const error = new Error("Address in use") as NodeJS.ErrnoException;
					error.code = "EADDRINUSE";
					server.emit("error", error);
				});
			pushError();
			pushError();
			pushError();
			const result = await startLocalOAuthServer({ state: "test-state" });
			const code = await result.waitForCode("test-state");
			expect(code).toBeNull();
		});

		it("should return code when available", async () => {
			queueListenBehavior((server) => server.emit("listening"));
			const result = await startLocalOAuthServer({ state: "test-state" });
			getLastServer()._handler?.(
				createMockRequest("/auth/callback?code=the-code&state=test-state"),
				createMockResponse(),
			);
			const code = await result.waitForCode("test-state");
			expect(code).toEqual({ code: "the-code" });
		});

		it("should consume captured code only once", async () => {
			vi.useFakeTimers();
			queueListenBehavior((server) => server.emit("listening"));
			const result = await startLocalOAuthServer({ state: "test-state" });
			getLastServer()._handler?.(
				createMockRequest("/auth/callback?code=one-time-code&state=test-state"),
				createMockResponse(),
			);
			const first = await result.waitForCode("test-state");
			expect(first).toEqual({ code: "one-time-code" });
			const secondPromise = result.waitForCode("test-state");
			await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
			const second = await secondPromise;
			expect(second).toBeNull();
			vi.useRealTimers();
		});

		it("should return null after 5 minute timeout", async () => {
			vi.useFakeTimers();
			queueListenBehavior((server) => server.emit("listening"));
			const result = await startLocalOAuthServer({ state: "test-state" });
			const codePromise = result.waitForCode("test-state");
			await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
			const code = await codePromise;
			expect(code).toBeNull();
			expect(logWarn).toHaveBeenCalledWith("OAuth poll timeout after 5 minutes");
			vi.useRealTimers();
		});
	});
});
