import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectExistingConfig, writeConfig } from "../src/setup.js";

const readFileMock = vi.fn();
const mkdirMock = vi.fn();
const writeFileMock = vi.fn();

vi.mock("node:fs/promises", () => ({
	readFile: (...args: unknown[]) => readFileMock(...args),
	mkdir: (...args: unknown[]) => mkdirMock(...args),
	writeFile: (...args: unknown[]) => writeFileMock(...args),
}));

vi.mock("node:os", () => ({
	homedir: () => "/home/testuser",
}));

describe("detectExistingConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("detects config in cwd", async () => {
		readFileMock.mockImplementation((path: string) => {
			if (path.includes("a-eyes.config.json")) {
				return Promise.resolve(JSON.stringify({ allowlist: ["Chrome"] }));
			}
			return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
		});

		const result = await detectExistingConfig();

		expect(result.found).toBe(true);
		expect(result.source).toBe("cwd");
		expect(result.hasAllowlist).toBe(true);
		expect(result.allowlist).toEqual(["Chrome"]);
	});

	it("detects config in home dir when cwd has none", async () => {
		readFileMock.mockImplementation((path: string) => {
			if (path.includes(join(".a-eyes", "config.json"))) {
				return Promise.resolve(JSON.stringify({ allowlist: ["VS Code"] }));
			}
			return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
		});

		const result = await detectExistingConfig();

		expect(result.found).toBe(true);
		expect(result.source).toBe("home");
		expect(result.hasAllowlist).toBe(true);
		expect(result.allowlist).toEqual(["VS Code"]);
	});

	it("returns not found when no config exists", async () => {
		readFileMock.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

		const result = await detectExistingConfig();

		expect(result.found).toBe(false);
		expect(result.path).toBeNull();
		expect(result.source).toBeNull();
		expect(result.hasAllowlist).toBe(false);
		expect(result.allowlist).toEqual([]);
	});

	it("detects config without allowlist", async () => {
		readFileMock.mockImplementation((path: string) => {
			if (path.includes(join(".a-eyes", "config.json"))) {
				return Promise.resolve(JSON.stringify({ save_screenshots: true }));
			}
			return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
		});

		const result = await detectExistingConfig();

		expect(result.found).toBe(true);
		expect(result.hasAllowlist).toBe(false);
		expect(result.allowlist).toEqual([]);
	});

	it("detects config with empty allowlist", async () => {
		readFileMock.mockImplementation((path: string) => {
			if (path.includes(join(".a-eyes", "config.json"))) {
				return Promise.resolve(JSON.stringify({ allowlist: [] }));
			}
			return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
		});

		const result = await detectExistingConfig();

		expect(result.found).toBe(true);
		expect(result.hasAllowlist).toBe(false);
		expect(result.allowlist).toEqual([]);
	});
});

describe("writeConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mkdirMock.mockResolvedValue(undefined);
		writeFileMock.mockResolvedValue(undefined);
	});

	it("writes config to ~/.a-eyes/config.json", async () => {
		const path = await writeConfig(["Chrome", "VS Code"]);

		expect(path).toBe(join("/home/testuser", ".a-eyes", "config.json"));
		expect(mkdirMock).toHaveBeenCalledWith(join("/home/testuser", ".a-eyes"), { recursive: true });
		expect(writeFileMock).toHaveBeenCalledWith(
			join("/home/testuser", ".a-eyes", "config.json"),
			expect.stringContaining('"allowlist"'),
			"utf-8",
		);
	});

	it("writes valid JSON with allowlist", async () => {
		await writeConfig(["Chrome"]);

		const writtenContent = writeFileMock.mock.calls[0][1] as string;
		const parsed = JSON.parse(writtenContent);
		expect(parsed).toEqual({ allowlist: ["Chrome"] });
	});

	it("propagates write errors", async () => {
		writeFileMock.mockRejectedValue(new Error("Permission denied"));

		await expect(writeConfig(["Chrome"])).rejects.toThrow("Permission denied");
	});
});
