import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../src/rate-limiter.js";

describe("RateLimiter", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("allows all requests when maxPerMinute is 0 (unlimited)", () => {
		const limiter = new RateLimiter(0);
		for (let i = 0; i < 100; i++) {
			expect(limiter.isAllowed()).toBe(true);
			limiter.record();
		}
	});

	it("allows requests up to the limit", () => {
		const limiter = new RateLimiter(3);
		for (let i = 0; i < 3; i++) {
			expect(limiter.isAllowed()).toBe(true);
			limiter.record();
		}
		expect(limiter.isAllowed()).toBe(false);
	});

	it("allows requests again after the window expires", () => {
		const limiter = new RateLimiter(2);
		limiter.record();
		limiter.record();
		expect(limiter.isAllowed()).toBe(false);

		// Advance past the 60-second window
		vi.advanceTimersByTime(60_001);
		expect(limiter.isAllowed()).toBe(true);
	});

	it("uses sliding window — old entries expire individually", () => {
		const limiter = new RateLimiter(2);
		limiter.record(); // t=0
		vi.advanceTimersByTime(30_000);
		limiter.record(); // t=30s
		expect(limiter.isAllowed()).toBe(false);

		// At t=60.001s, the first entry (t=0) expires
		vi.advanceTimersByTime(30_001);
		expect(limiter.isAllowed()).toBe(true);
	});

	it("returns correct retryAfterSeconds", () => {
		const limiter = new RateLimiter(1);
		limiter.record();
		expect(limiter.retryAfterSeconds()).toBe(60);

		vi.advanceTimersByTime(45_000);
		expect(limiter.retryAfterSeconds()).toBe(15);
	});

	it("returns 0 retryAfterSeconds when empty", () => {
		const limiter = new RateLimiter(1);
		expect(limiter.retryAfterSeconds()).toBe(0);
	});
});
