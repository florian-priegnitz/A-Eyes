import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: execFileMock,
}));

describe("capture module", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("passes window title as raw argv value and parses JSON result", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"image":"ZmFrZQ==","title":"My App"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		const result = await captureWindow("O'Hara App");

		expect(result).toEqual({
			base64: "ZmFrZQ==",
			windowTitle: "My App",
		});

		const args = execFileMock.mock.calls[0][1] as string[];
		const titleArgIndex = args.indexOf("-WindowTitle");
		expect(titleArgIndex).toBeGreaterThan(-1);
		expect(args[titleArgIndex + 1]).toBe("O'Hara App");
	});

	it("rejects with timeout error when child process is killed", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			const err = Object.assign(new Error("timed out"), { killed: true });
			callback(err, "", "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		await expect(captureWindow("Any Window", 1234)).rejects.toThrow(
			"Screenshot capture timed out after 1234ms",
		);
	});

	it("rejects with script error message", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(new Error("failed"), "", "Window not found");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		await expect(captureWindow("Missing Window")).rejects.toThrow(
			"Screenshot capture failed: Window not found",
		);
	});

	it("shows actionable message when WSL interop is unavailable", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(
				new Error("spawn failed"),
				"",
				"/mnt/c/.../powershell.exe: cannot execute binary file: Exec format error",
			);
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		await expect(captureWindow("Chrome")).rejects.toThrow("Windows interop is not available");
	});

	it("parses JSON from the last non-empty line", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, 'WARNING: noisy line\n\n{"image":"ZmFrZQ==","title":"Chrome"}\n', "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		const result = await captureWindow("Chrome");
		expect(result).toEqual({ base64: "ZmFrZQ==", windowTitle: "Chrome" });
	});

	it("passes max_width as -MaxWidth PowerShell argument", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"image":"ZmFrZQ==","title":"Chrome"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		await captureWindow("Chrome", undefined, 800);

		const args = execFileMock.mock.calls[0][1] as string[];
		const maxWidthIndex = args.indexOf("-MaxWidth");
		expect(maxWidthIndex).toBeGreaterThan(-1);
		expect(args[maxWidthIndex + 1]).toBe("800");
	});

	it("does not pass -MaxWidth when maxWidth is not set", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"image":"ZmFrZQ==","title":"Chrome"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		await captureWindow("Chrome");

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).not.toContain("-MaxWidth");
	});

	it("rejects when output is neither JSON nor base64", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, "unexpected-output", "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		await expect(captureWindow("Chrome")).rejects.toThrow("Failed to parse screenshot output");
	});
});
