import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	generateFilename,
	resolveOutputPath,
	sanitizeForFilename,
	saveScreenshot,
} from "../src/save-screenshot.js";

describe("sanitizeForFilename", () => {
	it("removes illegal characters", () => {
		expect(sanitizeForFilename('My:File*Name?"test')).toBe("MyFileNametest");
	});

	it("collapses whitespace and underscores", () => {
		expect(sanitizeForFilename("Hello   World__Test")).toBe("Hello_World_Test");
	});

	it("trims leading and trailing underscores", () => {
		expect(sanitizeForFilename("  _hello_ ")).toBe("hello");
	});

	it("truncates to 80 characters", () => {
		const long = "A".repeat(100);
		expect(sanitizeForFilename(long)).toHaveLength(80);
	});

	it("returns fallback for empty result", () => {
		expect(sanitizeForFilename(":::")).toBe("screenshot");
	});

	it("handles empty string", () => {
		expect(sanitizeForFilename("")).toBe("screenshot");
	});
});

describe("generateFilename", () => {
	it("produces expected format", () => {
		const date = new Date("2026-03-08T14:30:45");
		const filename = generateFilename("My Window", undefined, date);
		expect(filename).toBe("My_Window_20260308_143045.png");
	});

	it("uses sanitized title", () => {
		const date = new Date("2026-01-01T00:00:00");
		const filename = generateFilename("Bad:Name*Here", undefined, date);
		expect(filename).toBe("BadNameHere_20260101_000000.png");
	});

	it("uses .jpg extension for jpeg format", () => {
		const date = new Date("2026-03-08T14:30:45");
		const filename = generateFilename("My Window", "jpeg", date);
		expect(filename).toBe("My_Window_20260308_143045.jpg");
	});

	it("uses .png extension for png format", () => {
		const date = new Date("2026-03-08T14:30:45");
		const filename = generateFilename("My Window", "png", date);
		expect(filename).toBe("My_Window_20260308_143045.png");
	});
});

describe("resolveOutputPath", () => {
	it("returns path as-is when it ends with .png", () => {
		expect(resolveOutputPath("/tmp/my-shot.png", "Chrome")).toBe("/tmp/my-shot.png");
	});

	it("returns path as-is for .PNG (case-insensitive)", () => {
		expect(resolveOutputPath("/tmp/shot.PNG", "Chrome")).toBe("/tmp/shot.PNG");
	});

	it("appends generated filename when path is a directory", () => {
		const result = resolveOutputPath("/tmp/screenshots", "Chrome");
		expect(result).toMatch(/^\/tmp\/screenshots\/Chrome_\d{8}_\d{6}\.png$/);
	});

	it("returns path as-is when it ends with .jpg", () => {
		expect(resolveOutputPath("/tmp/shot.jpg", "Chrome")).toBe("/tmp/shot.jpg");
	});

	it("returns path as-is when it ends with .jpeg", () => {
		expect(resolveOutputPath("/tmp/shot.jpeg", "Chrome")).toBe("/tmp/shot.jpeg");
	});

	it("appends .jpg filename for jpeg format in directory", () => {
		const result = resolveOutputPath("/tmp/screenshots", "Chrome", "jpeg");
		expect(result).toMatch(/^\/tmp\/screenshots\/Chrome_\d{8}_\d{6}\.jpg$/);
	});
});

describe("saveScreenshot", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "a-eyes-save-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true });
	});

	it("writes base64 data as binary file", async () => {
		const base64 = Buffer.from("fake-png-data").toString("base64");
		const outputPath = join(tempDir, "test.png");

		const result = await saveScreenshot(base64, outputPath);

		expect(result).toBe(outputPath);
		const content = await readFile(outputPath);
		expect(content.toString()).toBe("fake-png-data");
	});

	it("creates nested directories", async () => {
		const base64 = Buffer.from("data").toString("base64");
		const outputPath = join(tempDir, "sub", "dir", "test.png");

		await saveScreenshot(base64, outputPath);

		const content = await readFile(outputPath);
		expect(content.toString()).toBe("data");
	});
});
