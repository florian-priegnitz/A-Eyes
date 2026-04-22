import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: execFileMock,
}));

const baseResult = JSON.stringify({
	title: "Notepad",
	processName: "notepad",
	windowWidth: 800,
	windowHeight: 600,
	elementCount: 0,
	elements: [],
	text: "Hello",
});

describe("seeWindow module", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it("forwards -Mode text when mode='text'", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, baseResult, "");
			return { stdin: { end: vi.fn() } };
		});

		const { seeWindow } = await import("../src/see.js");
		await seeWindow("Notepad", undefined, 30000, "text");

		const args = execFileMock.mock.calls[0][1] as string[];
		const modeIdx = args.indexOf("-Mode");
		expect(modeIdx).toBeGreaterThan(-1);
		expect(args[modeIdx + 1]).toBe("text");
	});

	it("forwards -Mode full when mode='full'", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, baseResult, "");
			return { stdin: { end: vi.fn() } };
		});

		const { seeWindow } = await import("../src/see.js");
		await seeWindow("Notepad", undefined, 30000, "full");

		const args = execFileMock.mock.calls[0][1] as string[];
		const modeIdx = args.indexOf("-Mode");
		expect(modeIdx).toBeGreaterThan(-1);
		expect(args[modeIdx + 1]).toBe("full");
	});

	it("omits -Mode when mode is undefined", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, baseResult, "");
			return { stdin: { end: vi.fn() } };
		});

		const { seeWindow } = await import("../src/see.js");
		await seeWindow("Notepad", undefined, 30000, undefined);

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).not.toContain("-Mode");
	});

	it("passes window title as -WindowTitle arg", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, baseResult, "");
			return { stdin: { end: vi.fn() } };
		});

		const { seeWindow } = await import("../src/see.js");
		await seeWindow("My App", undefined, 30000, "text");

		const args = execFileMock.mock.calls[0][1] as string[];
		const titleIdx = args.indexOf("-WindowTitle");
		expect(titleIdx).toBeGreaterThan(-1);
		expect(args[titleIdx + 1]).toBe("My App");
	});

	it("omits -WindowTitle when windowTitle is undefined", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, baseResult, "");
			return { stdin: { end: vi.fn() } };
		});

		const { seeWindow } = await import("../src/see.js");
		await seeWindow(undefined, "notepad", 30000, "text");

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).not.toContain("-WindowTitle");
	});

	it("rejects with timeout error when child process is killed", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			const err = Object.assign(new Error("timed out"), { killed: true });
			callback(err, "", "");
			return { stdin: { end: vi.fn() } };
		});

		const { seeWindow } = await import("../src/see.js");
		await expect(seeWindow("Notepad", undefined, 5000, "full")).rejects.toThrow(
			"See timed out after 5000ms",
		);
	});

	it("rejects with error message on PowerShell failure", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(new Error("failed"), "", "Window not found");
			return { stdin: { end: vi.fn() } };
		});

		const { seeWindow } = await import("../src/see.js");
		await expect(seeWindow("Missing", undefined, 30000, "text")).rejects.toThrow("See failed:");
	});

	it("rejects when no output from script", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, "", "");
			return { stdin: { end: vi.fn() } };
		});

		const { seeWindow } = await import("../src/see.js");
		await expect(seeWindow("Notepad", undefined, 30000, "full")).rejects.toThrow(
			"No output from see script",
		);
	});

	it("rejects when result contains error field", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, JSON.stringify({ error: "Window not found" }), "");
			return { stdin: { end: vi.fn() } };
		});

		const { seeWindow } = await import("../src/see.js");
		await expect(seeWindow("Ghost", undefined, 30000, "full")).rejects.toThrow("Window not found");
	});

	it("parses full SeeResult from JSON output", async () => {
		const payload = {
			title: "Chrome",
			processName: "chrome",
			windowWidth: 1920,
			windowHeight: 1080,
			elementCount: 2,
			elements: [
				{
					id: "elem_0",
					type: "Button",
					name: "Search",
					value: "",
					enabled: true,
					bounds: { x: 0, y: 0, width: 100, height: 30 },
				},
			],
			text: "Search",
			image: "ZmFrZQ==",
		};

		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, JSON.stringify(payload), "");
			return { stdin: { end: vi.fn() } };
		});

		const { seeWindow } = await import("../src/see.js");
		const result = await seeWindow("Chrome", undefined, 30000, "full");

		expect(result.windowTitle).toBe("Chrome");
		expect(result.processName).toBe("chrome");
		expect(result.windowWidth).toBe(1920);
		expect(result.windowHeight).toBe(1080);
		expect(result.elementCount).toBe(2);
		expect(result.elements).toHaveLength(1);
		expect(result.text).toBe("Search");
		expect(result.image).toBe("ZmFrZQ==");
	});
});
