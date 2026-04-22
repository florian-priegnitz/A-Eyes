import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	GENESIS_HASH,
	_resetKeyCache,
	computeHmac,
	getAuditKey,
	signEntry,
} from "../src/audit-signing.js";

describe("audit-signing", () => {
	let tempDir: string;

	beforeEach(async () => {
		_resetKeyCache();
		tempDir = await mkdtemp(join(tmpdir(), "a-eyes-test-"));
	});

	afterEach(async () => {
		_resetKeyCache();
		process.env.A_EYES_AUDIT_KEY = undefined;
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("computeHmac", () => {
		it("returns deterministic hex-encoded HMAC-SHA256", () => {
			const key = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
			const result1 = computeHmac(key, "test data");
			const result2 = computeHmac(key, "test data");
			expect(result1).toBe(result2);
			expect(result1).toHaveLength(64); // 256 bits = 64 hex chars
		});

		it("produces different HMAC for different data", () => {
			const key = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
			const a = computeHmac(key, "data A");
			const b = computeHmac(key, "data B");
			expect(a).not.toBe(b);
		});

		it("produces different HMAC for different keys", () => {
			const key1 = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
			const key2 = Buffer.from("fedcba9876543210fedcba9876543210", "hex");
			const a = computeHmac(key1, "same data");
			const b = computeHmac(key2, "same data");
			expect(a).not.toBe(b);
		});
	});

	describe("signEntry", () => {
		it("produces sig and prev_hash fields", () => {
			const key = Buffer.from("abcdef0123456789abcdef0123456789", "hex");
			const entryJson = '{"tool":"capture","result":"success"}';
			const result = signEntry(key, entryJson, GENESIS_HASH);

			expect(result.sig).toHaveLength(64);
			expect(result.prev_hash).toBe(GENESIS_HASH);
		});

		it("chain links: entry N prev_hash references entry N-1 sig", () => {
			const key = Buffer.from("abcdef0123456789abcdef0123456789", "hex");

			const entry1 = signEntry(key, '{"n":1}', GENESIS_HASH);
			const entry2 = signEntry(key, '{"n":2}', entry1.sig);

			expect(entry2.prev_hash).toBe(entry1.sig);
		});

		it("different content produces different sig", () => {
			const key = Buffer.from("abcdef0123456789abcdef0123456789", "hex");

			const a = signEntry(key, '{"tool":"capture"}', GENESIS_HASH);
			const b = signEntry(key, '{"tool":"query"}', GENESIS_HASH);

			expect(a.sig).not.toBe(b.sig);
		});
	});

	describe("getAuditKey", () => {
		it("reads key from env var", async () => {
			const hexKey = "a".repeat(64);
			process.env.A_EYES_AUDIT_KEY = hexKey;

			const key = await getAuditKey();
			expect(key.toString("hex")).toBe(hexKey);
		});

		it("caches key after first load", async () => {
			process.env.A_EYES_AUDIT_KEY = "b".repeat(64);

			const key1 = await getAuditKey();
			process.env.A_EYES_AUDIT_KEY = undefined;
			const key2 = await getAuditKey();

			expect(key1).toBe(key2); // Same Buffer reference
		});
	});

	describe("GENESIS_HASH", () => {
		it("is 64 zero characters", () => {
			expect(GENESIS_HASH).toBe("0".repeat(64));
			expect(GENESIS_HASH).toHaveLength(64);
		});
	});
});
