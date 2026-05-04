export class RateLimiter {
	private timestamps: number[] = [];

	constructor(private maxPerMinute: number) {}

	isAllowed(): boolean {
		if (this.maxPerMinute <= 0) return true;
		const now = Date.now();
		this.timestamps = this.timestamps.filter((t) => now - t < 60_000);
		return this.timestamps.length < this.maxPerMinute;
	}

	record(): void {
		this.timestamps.push(Date.now());
	}

	/**
	 * Atomically reserve N slots. Returns true and records N timestamps if allowed;
	 * returns false (without recording anything) if N would exceed maxPerMinute.
	 */
	tryReserve(n: number): boolean {
		if (this.maxPerMinute <= 0) return true;
		const now = Date.now();
		this.timestamps = this.timestamps.filter((t) => now - t < 60_000);
		if (this.timestamps.length + n > this.maxPerMinute) return false;
		for (let i = 0; i < n; i++) {
			this.timestamps.push(now);
		}
		return true;
	}

	/** Seconds until the oldest entry expires from the window. */
	retryAfterSeconds(): number {
		if (this.timestamps.length === 0) return 0;
		const oldest = this.timestamps[0];
		return Math.max(0, Math.ceil((oldest + 60_000 - Date.now()) / 1000));
	}
}
