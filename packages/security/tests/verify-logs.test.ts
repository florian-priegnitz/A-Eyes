import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GENESIS_HASH, signEntry } from "../src/audit-signing.js";
import { verifyLogFile } from "../src/verify-logs.js";

describe("verifyLogFile", () => {
	let tempDir: string;
	const key = Buffer.from("abcdef0123456789abcdef0123456789", "hex");

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "a-eyes-verify-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	function createSignedLine(
		entry: Record<string, unknown>,
		prevHash: string,
	): { line: string; sig: string } {
		const entryJson = JSON.stringify(entry);
		const { sig, prev_hash } = signEntry(key, entryJson, prevHash);
		const signedEntry = { ...entry, sig, prev_hash };
		return { line: JSON.stringify(signedEntry), sig };
	}

	it("verifies a clean signed log file", async () => {
		const entry1 = { tool: "capture", result: "success", timestamp: "2026-03-23T10:00:00Z" };
		const entry2 = { tool: "query", result: "success", timestamp: "2026-03-23T10:01:00Z" };

		const line1 = createSignedLine(entry1, GENESIS_HASH);
		const line2 = createSignedLine(entry2, line1.sig);

		const filePath = join(tempDir, "audit-test.jsonl");
		await writeFile(filePath, `${line1.line}\n${line2.line}\n`);

		const result = await verifyLogFile(filePath, key);
		expect(result.valid).toBe(2);
		expect(result.unsigned).toBe(0);
		expect(result.tampered).toBe(0);
		expect(result.errors).toHaveLength(0);
	});

	it("detects tampered content", async () => {
		const entry = { tool: "capture", result: "success", timestamp: "2026-03-23T10:00:00Z" };
		const { line } = createSignedLine(entry, GENESIS_HASH);

		// Tamper: change result
		const tampered = line.replace('"success"', '"error"');

		const filePath = join(tempDir, "audit-tampered.jsonl");
		await writeFile(filePath, `${tampered}\n`);

		const result = await verifyLogFile(filePath, key);
		expect(result.tampered).toBe(1);
		expect(result.errors[0]).toContain("HMAC mismatch");
	});

	it("detects broken chain", async () => {
		const entry1 = { tool: "capture", result: "success", timestamp: "2026-03-23T10:00:00Z" };
		const entry2 = { tool: "query", result: "success", timestamp: "2026-03-23T10:01:00Z" };

		const line1 = createSignedLine(entry1, GENESIS_HASH);
		// Use wrong prev_hash (genesis instead of line1.sig)
		const line2 = createSignedLine(entry2, GENESIS_HASH);

		const filePath = join(tempDir, "audit-chain.jsonl");
		await writeFile(filePath, `${line1.line}\n${line2.line}\n`);

		const result = await verifyLogFile(filePath, key);
		expect(result.valid).toBe(1); // First entry is valid
		expect(result.tampered).toBe(1); // Second has broken chain
		expect(result.errors[0]).toContain("chain broken");
	});

	it("handles unsigned entries (backward compat)", async () => {
		const unsigned = JSON.stringify({
			tool: "capture",
			result: "success",
			timestamp: "2026-03-23T10:00:00Z",
		});

		const filePath = join(tempDir, "audit-unsigned.jsonl");
		await writeFile(filePath, `${unsigned}\n`);

		const result = await verifyLogFile(filePath, key);
		expect(result.unsigned).toBe(1);
		expect(result.tampered).toBe(0);
		expect(result.valid).toBe(0);
	});

	it("handles mixed signed and unsigned entries", async () => {
		const unsigned = JSON.stringify({
			tool: "capture",
			result: "success",
			timestamp: "2026-03-23T09:00:00Z",
		});
		const entry = { tool: "query", result: "success", timestamp: "2026-03-23T10:00:00Z" };
		const signed = createSignedLine(entry, GENESIS_HASH);

		const filePath = join(tempDir, "audit-mixed.jsonl");
		await writeFile(filePath, `${unsigned}\n${signed.line}\n`);

		const result = await verifyLogFile(filePath, key);
		expect(result.unsigned).toBe(1);
		expect(result.valid).toBe(1);
		expect(result.tampered).toBe(0);
	});

	it("handles invalid JSON lines", async () => {
		const filePath = join(tempDir, "audit-bad.jsonl");
		await writeFile(filePath, "not valid json\n");

		const result = await verifyLogFile(filePath, key);
		expect(result.tampered).toBe(1);
		expect(result.errors[0]).toContain("invalid JSON");
	});
});
