import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AuditEntry,
	_resetAuditCache,
	getAuditLogPath,
	writeAuditEntry,
} from "../src/audit-log.js";
import { _resetKeyCache } from "../src/audit-signing.js";

// Mock os.homedir so logs go to a temp directory
const testDir = join(tmpdir(), `a-eyes-audit-test-${process.pid}`);
vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return { ...actual, homedir: () => testDir };
});

describe("getAuditLogPath", () => {
	it("returns path with correct date format", () => {
		const date = new Date("2026-03-08T14:30:00.000Z");
		const path = getAuditLogPath(date);
		expect(path).toBe(join(testDir, ".a-eyes", "logs", "audit-2026-03-08.jsonl"));
	});

	it("pads single-digit month and day", () => {
		const date = new Date("2026-01-05T10:00:00.000Z");
		const path = getAuditLogPath(date);
		expect(path).toContain("audit-2026-01-05.jsonl");
	});

	it("uses current date when no argument provided", () => {
		const path = getAuditLogPath();
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		const expected = `audit-${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}.jsonl`;
		expect(path).toContain(expected);
	});
});

describe("writeAuditEntry", () => {
	beforeEach(async () => {
		_resetAuditCache();
		_resetKeyCache();
		await rm(join(testDir, ".a-eyes"), { recursive: true, force: true });
	});

	afterEach(async () => {
		_resetAuditCache();
		_resetKeyCache();
		await rm(join(testDir, ".a-eyes"), { recursive: true, force: true });
	});

	it("creates directory and writes JSONL entry", async () => {
		const entry: AuditEntry = {
			timestamp: "2026-03-08T14:30:00.000Z",
			tool: "capture",
			params: { window_title: "Chrome" },
			result: "success",
			duration_ms: 1234,
		};

		await writeAuditEntry(entry);

		const logPath = join(testDir, ".a-eyes", "logs", "audit-2026-03-08.jsonl");
		const content = await readFile(logPath, "utf-8");
		const parsed = JSON.parse(content.trim());
		expect(parsed).toMatchObject(entry);
		expect(parsed.sig).toBeDefined();
		expect(parsed.prev_hash).toBeDefined();
		expect(parsed.sig).toHaveLength(64);
	});

	it("appends multiple entries to the same file", async () => {
		const entry1: AuditEntry = {
			timestamp: "2026-03-08T14:30:00.000Z",
			tool: "capture",
			params: { window_title: "Chrome" },
			result: "success",
			duration_ms: 100,
		};
		const entry2: AuditEntry = {
			timestamp: "2026-03-08T14:31:00.000Z",
			tool: "list_windows",
			params: {},
			result: "success",
			duration_ms: 200,
			windows_count: 5,
		};

		await writeAuditEntry(entry1);
		await writeAuditEntry(entry2);

		const logPath = join(testDir, ".a-eyes", "logs", "audit-2026-03-08.jsonl");
		const lines = (await readFile(logPath, "utf-8")).trim().split("\n");
		expect(lines).toHaveLength(2);
		const parsed0 = JSON.parse(lines[0]);
		const parsed1 = JSON.parse(lines[1]);
		expect(parsed0).toMatchObject(entry1);
		expect(parsed1).toMatchObject(entry2);
		// Verify hash chain
		expect(parsed1.prev_hash).toBe(parsed0.sig);
	});

	it("includes optional error field", async () => {
		const entry: AuditEntry = {
			timestamp: "2026-03-08T14:30:00.000Z",
			tool: "capture",
			params: { window_title: "Secret" },
			result: "blocked",
			duration_ms: 2,
			error: "Not in allowlist",
		};

		await writeAuditEntry(entry);

		const logPath = join(testDir, ".a-eyes", "logs", "audit-2026-03-08.jsonl");
		const parsed = JSON.parse((await readFile(logPath, "utf-8")).trim());
		expect(parsed.result).toBe("blocked");
		expect(parsed.error).toBe("Not in allowlist");
	});

	it("writes to different files for different dates", async () => {
		const entry1: AuditEntry = {
			timestamp: "2026-03-08T23:59:00.000Z",
			tool: "capture",
			params: { window_title: "Chrome" },
			result: "success",
			duration_ms: 100,
		};
		const entry2: AuditEntry = {
			timestamp: "2026-03-09T00:01:00.000Z",
			tool: "capture",
			params: { window_title: "Chrome" },
			result: "success",
			duration_ms: 100,
		};

		await writeAuditEntry(entry1);
		await writeAuditEntry(entry2);

		const log1 = join(testDir, ".a-eyes", "logs", "audit-2026-03-08.jsonl");
		const log2 = join(testDir, ".a-eyes", "logs", "audit-2026-03-09.jsonl");
		const lines1 = (await readFile(log1, "utf-8")).trim().split("\n");
		const lines2 = (await readFile(log2, "utf-8")).trim().split("\n");
		expect(lines1).toHaveLength(1);
		expect(lines2).toHaveLength(1);
	});
});
