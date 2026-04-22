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

	describe("tryReserve", () => {
		it("succeeds and records N timestamps when slots are available", () => {
			const limiter = new RateLimiter(10);
			expect(limiter.tryReserve(3)).toBe(true);
			// After reserving 3, only 7 remain — reserving 7 more should succeed
			expect(limiter.tryReserve(7)).toBe(true);
			// Now at limit — isAllowed returns false
			expect(limiter.isAllowed()).toBe(false);
		});

		it("fails and records nothing when N would exceed the limit", () => {
			const limiter = new RateLimiter(5);
			limiter.record();
			limiter.record(); // 2 used, 3 remaining
			// Trying to reserve 4 should fail
			expect(limiter.tryReserve(4)).toBe(false);
			// No additional timestamps recorded — still only 2 used
			expect(limiter.isAllowed()).toBe(true);
			limiter.record(); // 3 used — still allowed (limit 5)
			expect(limiter.isAllowed()).toBe(true);
		});

		it("always succeeds when maxPerMinute is 0 (unlimited)", () => {
			const limiter = new RateLimiter(0);
			expect(limiter.tryReserve(1000)).toBe(true);
			// Still allowed since unlimited
			expect(limiter.isAllowed()).toBe(true);
		});

		it("exactly at limit — reserving 1 fails", () => {
			const limiter = new RateLimiter(3);
			limiter.record();
			limiter.record();
			limiter.record();
			expect(limiter.tryReserve(1)).toBe(false);
		});
	});
});
