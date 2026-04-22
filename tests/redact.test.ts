import { describe, expect, it } from "vitest";
import type { AEyesConfig } from "../src/config.js";
import { applyRedactions, findMatchingRules } from "../src/redact.js";

const baseConfig: AEyesConfig = {
	save_screenshots: false,
	screenshot_dir: "./screenshots",
	max_captures_per_minute: 0,
	allow_event_log: false,
};

describe("findMatchingRules", () => {
	it("returns empty array when no redaction rules configured", () => {
		const result = findMatchingRules(baseConfig, "Notepad", "notepad.exe");
		expect(result).toEqual([]);
	});

	it("returns empty array when no candidates provided", () => {
		const config: AEyesConfig = {
			...baseConfig,
			redaction_rules: [
				{ match: ".*", regions: [{ x: 0, y: 0, width: 100, height: 50, method: "blackout" }] },
			],
		};
		const result = findMatchingRules(config);
		expect(result).toEqual([]);
	});

	it("returns regions for matching window title", () => {
		const config: AEyesConfig = {
			...baseConfig,
			redaction_rules: [
				{
					match: "Password Manager",
					regions: [{ x: 10, y: 20, width: 200, height: 30, method: "blackout" }],
				},
			],
		};
		const result = findMatchingRules(config, "My Password Manager - vault");
		expect(result).toHaveLength(1);
		expect(result[0].x).toBe(10);
	});

	it("returns regions for matching process name", () => {
		const config: AEyesConfig = {
			...baseConfig,
			redaction_rules: [
				{
					match: "chrome",
					regions: [{ x: 0, y: 0, width: 100, height: 50, method: "blur" }],
				},
			],
		};
		const result = findMatchingRules(config, undefined, "chrome.exe");
		expect(result).toHaveLength(1);
	});

	it("merges regions from multiple matching rules", () => {
		const config: AEyesConfig = {
			...baseConfig,
			redaction_rules: [
				{
					match: "chrome",
					regions: [{ x: 0, y: 0, width: 100, height: 50, method: "blackout" }],
				},
				{
					match: "chrome",
					regions: [{ x: 200, y: 300, width: 50, height: 50, method: "pixelate" }],
				},
			],
		};
		const result = findMatchingRules(config, "Google Chrome");
		expect(result).toHaveLength(2);
	});

	it("skips rules with invalid regex", () => {
		const config: AEyesConfig = {
			...baseConfig,
			redaction_rules: [
				{
					match: "[invalid((",
					regions: [{ x: 0, y: 0, width: 100, height: 50, method: "blackout" }],
				},
			],
		};
		const result = findMatchingRules(config, "anything");
		expect(result).toEqual([]);
	});

	it("matches case-insensitively", () => {
		const config: AEyesConfig = {
			...baseConfig,
			redaction_rules: [
				{
					match: "NOTEPAD",
					regions: [{ x: 0, y: 0, width: 100, height: 50, method: "blackout" }],
				},
			],
		};
		const result = findMatchingRules(config, "notepad - file.txt");
		expect(result).toHaveLength(1);
	});

	it("returns empty for non-matching rules", () => {
		const config: AEyesConfig = {
			...baseConfig,
			redaction_rules: [
				{
					match: "^Firefox$",
					regions: [{ x: 0, y: 0, width: 100, height: 50, method: "blackout" }],
				},
			],
		};
		const result = findMatchingRules(config, "Google Chrome");
		expect(result).toEqual([]);
	});
});

describe("applyRedactions", () => {
	// Create a minimal 10x10 red PNG for testing
	async function createTestPng(width = 10, height = 10): Promise<string> {
		const sharp = (await import("sharp")).default;
		const buffer = await sharp({
			create: { width, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
		})
			.png()
			.toBuffer();
		return buffer.toString("base64");
	}

	it("returns original when no regions provided", async () => {
		const base64 = await createTestPng();
		const result = await applyRedactions(base64, []);
		expect(result.base64).toBe(base64);
		expect(result.redactedCount).toBe(0);
	});

	it("applies blackout redaction", async () => {
		const base64 = await createTestPng(100, 100);
		const result = await applyRedactions(base64, [
			{ x: 10, y: 10, width: 30, height: 30, method: "blackout" },
		]);
		expect(result.redactedCount).toBe(1);
		expect(result.base64).not.toBe(base64);

		// Verify output is still valid PNG with same dimensions
		const sharp = (await import("sharp")).default;
		const meta = await sharp(Buffer.from(result.base64, "base64")).metadata();
		expect(meta.width).toBe(100);
		expect(meta.height).toBe(100);
	});

	it("applies blur redaction", async () => {
		const base64 = await createTestPng(100, 100);
		const result = await applyRedactions(base64, [
			{ x: 10, y: 10, width: 30, height: 30, method: "blur" },
		]);
		expect(result.redactedCount).toBe(1);
		// Output is valid PNG with same dimensions
		const sharp = (await import("sharp")).default;
		const meta = await sharp(Buffer.from(result.base64, "base64")).metadata();
		expect(meta.width).toBe(100);
		expect(meta.height).toBe(100);
	});

	it("applies pixelate redaction", async () => {
		const base64 = await createTestPng(100, 100);
		const result = await applyRedactions(base64, [
			{ x: 10, y: 10, width: 30, height: 30, method: "pixelate" },
		]);
		expect(result.redactedCount).toBe(1);
		const sharp = (await import("sharp")).default;
		const meta = await sharp(Buffer.from(result.base64, "base64")).metadata();
		expect(meta.width).toBe(100);
		expect(meta.height).toBe(100);
	});

	it("handles multiple regions", async () => {
		const base64 = await createTestPng(100, 100);
		const result = await applyRedactions(base64, [
			{ x: 0, y: 0, width: 20, height: 20, method: "blackout" },
			{ x: 50, y: 50, width: 20, height: 20, method: "blur" },
		]);
		expect(result.redactedCount).toBe(2);
	});

	it("clamps regions that exceed image bounds", async () => {
		const base64 = await createTestPng(50, 50);
		const result = await applyRedactions(base64, [
			{ x: 40, y: 40, width: 100, height: 100, method: "blackout" },
		]);
		expect(result.redactedCount).toBe(1);

		const sharp = (await import("sharp")).default;
		const meta = await sharp(Buffer.from(result.base64, "base64")).metadata();
		expect(meta.width).toBe(50);
		expect(meta.height).toBe(50);
	});

	it("skips regions entirely outside image bounds", async () => {
		const base64 = await createTestPng(50, 50);
		const result = await applyRedactions(base64, [
			{ x: 500, y: 500, width: 100, height: 100, method: "blackout" },
		]);
		expect(result.redactedCount).toBe(0);
		expect(result.base64).toBe(base64);
	});
});
