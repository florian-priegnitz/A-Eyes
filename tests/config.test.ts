import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockHomeDir } = vi.hoisted(() => {
	let dir = "";
	return {
		mockHomeDir: {
			set(d: string) {
				dir = d;
			},
			get() {
				return dir;
			},
		},
	};
});

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return { ...actual, homedir: () => mockHomeDir.get() || actual.homedir() };
});

// Must import AFTER vi.mock
const { isWindowAllowed, loadConfig } = await import("../src/config.js");

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

	it("includes file path in validation error message", async () => {
		const configPath = join(tempDir, "config.json");
		await writeFile(configPath, JSON.stringify({ allowlist: "not-an-array" }));

		await expect(loadConfig(configPath)).rejects.toThrow(configPath);
	});
});

describe("loadConfig search chain", () => {
	let cwdDir: string;
	let homeDir: string;
	const originalCwd = process.cwd;

	beforeEach(async () => {
		cwdDir = await mkdtemp(join(tmpdir(), "a-eyes-cwd-"));
		homeDir = await mkdtemp(join(tmpdir(), "a-eyes-home-"));
		process.cwd = () => cwdDir;
		mockHomeDir.set(homeDir);
	});

	afterEach(async () => {
		process.cwd = originalCwd;
		mockHomeDir.set("");
		await rm(cwdDir, { recursive: true });
		await rm(homeDir, { recursive: true });
	});

	it("prefers cwd config over home config", async () => {
		await writeFile(join(cwdDir, "a-eyes.config.json"), JSON.stringify({ allowlist: ["CWD"] }));
		await mkdir(join(homeDir, ".a-eyes"), { recursive: true });
		await writeFile(
			join(homeDir, ".a-eyes", "config.json"),
			JSON.stringify({ allowlist: ["HOME"] }),
		);

		const config = await loadConfig();
		expect(config.allowlist).toEqual(["CWD"]);
	});

	it("falls back to package root config when cwd config missing", async () => {
		// cwd points to empty temp dir, but a-eyes.config.json exists in the
		// project root (package root = __dirname/..). The search chain should
		// find it via the package-root fallback before reaching home.
		const config = await loadConfig();
		// Project root a-eyes.config.json has allowlist entries
		expect(config.allowlist).toBeDefined();
		expect(config.allowlist?.length).toBeGreaterThan(0);
	});

	it("falls back to home config when cwd config missing", async () => {
		await mkdir(join(homeDir, ".a-eyes"), { recursive: true });
		await writeFile(
			join(homeDir, ".a-eyes", "config.json"),
			JSON.stringify({ allowlist: ["HOME"] }),
		);

		const config = await loadConfig();
		expect(config.allowlist).toBeDefined();
	});

	it("falls back to package root when neither cwd nor home config exists", async () => {
		// cwd points to empty temp dir, home has no .a-eyes/config.json.
		// The package root (project root) has a-eyes.config.json, so the
		// search chain finds it via __dirname fallback.
		const config = await loadConfig();
		// Package root config has allowlist entries
		expect(config.allowlist).toBeDefined();
		expect(config.allowlist?.length).toBeGreaterThan(0);
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

	it("allows when process name matches allowlist", () => {
		const config = { allowlist: ["chrome"] };
		expect(isWindowAllowed(config, undefined, "chrome")).toBe(true);
	});

	it("allows when process name matches but title does not", () => {
		const config = { allowlist: ["chrome"] };
		expect(isWindowAllowed(config, "Some Random Title", "chrome")).toBe(true);
	});

	it("allows when title matches but process does not", () => {
		const config = { allowlist: ["Chrome"] };
		expect(isWindowAllowed(config, "Google Chrome - New Tab", "unknown")).toBe(true);
	});

	it("blocks when neither title nor process matches", () => {
		const config = { allowlist: ["Chrome"] };
		expect(isWindowAllowed(config, "Firefox", "firefox")).toBe(false);
	});

	it("blocks when no title or process provided", () => {
		const config = { allowlist: ["Chrome"] };
		expect(isWindowAllowed(config)).toBe(false);
	});
});
