import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isWindowAllowed, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "a-eyes-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true });
	});

	it("returns default config when file does not exist", async () => {
		const config = await loadConfig(join(tempDir, "nonexistent.json"));
		expect(config.save_screenshots).toBe(false);
		expect(config.screenshot_dir).toBe("./screenshots");
	});

	it("loads valid config with allowlist", async () => {
		const configPath = join(tempDir, "config.json");
		await writeFile(configPath, JSON.stringify({ allowlist: ["Chrome", "VS Code"] }));

		const config = await loadConfig(configPath);
		expect(config.allowlist).toEqual(["Chrome", "VS Code"]);
	});

	it("loads valid config without allowlist", async () => {
		const configPath = join(tempDir, "config.json");
		await writeFile(configPath, JSON.stringify({}));

		const config = await loadConfig(configPath);
		expect(config.allowlist).toBeUndefined();
		expect(config.save_screenshots).toBe(false);
		expect(config.screenshot_dir).toBe("./screenshots");
	});

	it("loads config with save_screenshots enabled", async () => {
		const configPath = join(tempDir, "config.json");
		await writeFile(
			configPath,
			JSON.stringify({ save_screenshots: true, screenshot_dir: "/tmp/shots" }),
		);

		const config = await loadConfig(configPath);
		expect(config.save_screenshots).toBe(true);
		expect(config.screenshot_dir).toBe("/tmp/shots");
	});

	it("applies defaults for missing save fields", async () => {
		const configPath = join(tempDir, "config.json");
		await writeFile(configPath, JSON.stringify({ allowlist: ["Chrome"] }));

		const config = await loadConfig(configPath);
		expect(config.allowlist).toEqual(["Chrome"]);
		expect(config.save_screenshots).toBe(false);
		expect(config.screenshot_dir).toBe("./screenshots");
	});

	it("rejects invalid save_screenshots type", async () => {
		const configPath = join(tempDir, "config.json");
		await writeFile(configPath, JSON.stringify({ save_screenshots: "yes" }));

		await expect(loadConfig(configPath)).rejects.toThrow("Invalid config");
	});

	it("throws on invalid config schema", async () => {
		const configPath = join(tempDir, "config.json");
		await writeFile(configPath, JSON.stringify({ allowlist: "not-an-array" }));

		await expect(loadConfig(configPath)).rejects.toThrow("Invalid config");
	});

	it("throws on invalid JSON", async () => {
		const configPath = join(tempDir, "config.json");
		await writeFile(configPath, "not json");

		await expect(loadConfig(configPath)).rejects.toThrow();
	});
});

describe("isWindowAllowed", () => {
	it("blocks all windows when no allowlist configured", () => {
		expect(isWindowAllowed({}, "Any Window")).toBe(false);
	});

	it("blocks all windows when allowlist is empty", () => {
		expect(isWindowAllowed({ allowlist: [] }, "Any Window")).toBe(false);
	});

	it("allows matching window (case-insensitive)", () => {
		const config = { allowlist: ["Chrome"] };
		expect(isWindowAllowed(config, "Google Chrome - New Tab")).toBe(true);
	});

	it("blocks non-matching window", () => {
		const config = { allowlist: ["Chrome"] };
		expect(isWindowAllowed(config, "Firefox")).toBe(false);
	});

	it("matches case-insensitively", () => {
		const config = { allowlist: ["chrome"] };
		expect(isWindowAllowed(config, "Google CHROME")).toBe(true);
	});
});
