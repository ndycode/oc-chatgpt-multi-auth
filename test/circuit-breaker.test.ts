import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitOpenError,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  getCircuitBreaker,
} from "../lib/circuit-breaker.js";

describe("Circuit breaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts closed with default config", () => {
    const breaker = new CircuitBreaker();
    expect(breaker.getState()).toBe("closed");
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold).toBe(3);
  });

  it("allows execution when closed", () => {
    const breaker = new CircuitBreaker();
    expect(breaker.canExecute()).toBe(true);
  });

  it("opens after threshold failures within window", () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");
  });

  it("does not open if failures are outside window", () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure();
    vi.setSystemTime(new Date(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureWindowMs + 1));
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe("closed");
  });

  it("throws CircuitOpenError while open", () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(() => breaker.canExecute()).toThrow(CircuitOpenError);
  });

  it("transitions to half-open after reset timeout", () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    vi.setSystemTime(new Date(DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs + 1));
    expect(breaker.canExecute()).toBe(true);
    expect(breaker.getState()).toBe("half-open");
  });

  it("allows a single trial request in half-open", () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    vi.setSystemTime(new Date(DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs + 1));
    expect(breaker.canExecute()).toBe(true);
    expect(() => breaker.canExecute()).toThrow(CircuitOpenError);
  });

  it("closes on success from half-open", () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    vi.setSystemTime(new Date(DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs + 1));
    breaker.canExecute();
    breaker.recordSuccess();
    expect(breaker.getState()).toBe("closed");
    expect(breaker.canExecute()).toBe(true);
  });

  it("reopens on failure from half-open", () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    vi.setSystemTime(new Date(DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs + 1));
    breaker.canExecute();
    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");
  });

  it("reset returns to closed and clears failures", () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.reset();
    expect(breaker.getState()).toBe("closed");
    expect(breaker.canExecute()).toBe(true);
  });

  it("prunes failures on success in closed state", () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure();
    vi.setSystemTime(new Date(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureWindowMs + 1));
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe("closed");
  });

  it("half-open max attempts can be customized", () => {
    const breaker = new CircuitBreaker({ halfOpenMaxAttempts: 2 });
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    vi.setSystemTime(new Date(DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs + 1));
    expect(breaker.canExecute()).toBe(true);
    expect(breaker.canExecute()).toBe(true);
    expect(() => breaker.canExecute()).toThrow(CircuitOpenError);
  });

  it("records failure in half-open and reopens", () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    vi.setSystemTime(new Date(DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs + 1));
    breaker.canExecute();
    breaker.recordFailure();
    expect(() => breaker.canExecute()).toThrow(CircuitOpenError);
  });

  it("uses failure window threshold boundary", () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure();
    vi.setSystemTime(new Date(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureWindowMs - 1));
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");
  });

  it("returns singleton per key", () => {
    const first = getCircuitBreaker("alpha");
    const second = getCircuitBreaker("alpha");
    expect(first).toBe(second);
  });

  it("returns different instances for different keys", () => {
    const first = getCircuitBreaker("alpha");
    const second = getCircuitBreaker("beta");
    expect(first).not.toBe(second);
  });
});
