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

	it("passes crop parameters as PowerShell arguments", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"image":"ZmFrZQ==","title":"Unity"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		await captureWindow("Unity", undefined, undefined, { x: 100, y: 50, width: 400, height: 300 });

		const args = execFileMock.mock.calls[0][1] as string[];
		const cropXIndex = args.indexOf("-CropX");
		expect(cropXIndex).toBeGreaterThan(-1);
		expect(args[cropXIndex + 1]).toBe("100");

		const cropYIndex = args.indexOf("-CropY");
		expect(cropYIndex).toBeGreaterThan(-1);
		expect(args[cropYIndex + 1]).toBe("50");

		const cropWidthIndex = args.indexOf("-CropWidth");
		expect(cropWidthIndex).toBeGreaterThan(-1);
		expect(args[cropWidthIndex + 1]).toBe("400");

		const cropHeightIndex = args.indexOf("-CropHeight");
		expect(cropHeightIndex).toBeGreaterThan(-1);
		expect(args[cropHeightIndex + 1]).toBe("300");
	});

	it("does not pass crop flags when crop is not set", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"image":"ZmFrZQ==","title":"Chrome"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		await captureWindow("Chrome");

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).not.toContain("-CropX");
		expect(args).not.toContain("-CropY");
		expect(args).not.toContain("-CropWidth");
		expect(args).not.toContain("-CropHeight");
	});

	it("rejects when output is neither JSON nor base64", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, "unexpected-output", "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		await expect(captureWindow("Chrome")).rejects.toThrow("Failed to parse screenshot output");
	});

	it("passes process name as -ProcessName PowerShell argument", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"image":"ZmFrZQ==","title":"Chrome","processName":"chrome"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		const result = await captureWindow("Chrome", undefined, undefined, undefined, "chrome");

		const args = execFileMock.mock.calls[0][1] as string[];
		const processIndex = args.indexOf("-ProcessName");
		expect(processIndex).toBeGreaterThan(-1);
		expect(args[processIndex + 1]).toBe("chrome");
		expect(result.processName).toBe("chrome");
	});

	it("does not pass -ProcessName when processName is not set", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"image":"ZmFrZQ==","title":"Chrome"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		await captureWindow("Chrome");

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).not.toContain("-ProcessName");
	});

	it("passes format as -Format PowerShell argument", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"image":"ZmFrZQ==","title":"Chrome"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		await captureWindow("Chrome", undefined, undefined, undefined, undefined, "jpeg");

		const args = execFileMock.mock.calls[0][1] as string[];
		const formatIndex = args.indexOf("-Format");
		expect(formatIndex).toBeGreaterThan(-1);
		expect(args[formatIndex + 1]).toBe("JPEG");
	});

	it("passes quality as -Quality PowerShell argument", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"image":"ZmFrZQ==","title":"Chrome"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		await captureWindow("Chrome", undefined, undefined, undefined, undefined, "jpeg", 75);

		const args = execFileMock.mock.calls[0][1] as string[];
		const qualityIndex = args.indexOf("-Quality");
		expect(qualityIndex).toBeGreaterThan(-1);
		expect(args[qualityIndex + 1]).toBe("75");
	});

	it("does not pass -Format or -Quality when not set", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"image":"ZmFrZQ==","title":"Chrome"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		await captureWindow("Chrome");

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).not.toContain("-Format");
		expect(args).not.toContain("-Quality");
	});

	it("passes only -ProcessName without -WindowTitle when title is undefined", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"image":"ZmFrZQ==","title":"Google Chrome","processName":"chrome"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		const result = await captureWindow(undefined, undefined, undefined, undefined, "chrome");

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).not.toContain("-WindowTitle");
		const processIndex = args.indexOf("-ProcessName");
		expect(processIndex).toBeGreaterThan(-1);
		expect(args[processIndex + 1]).toBe("chrome");
		expect(result.windowTitle).toBe("Google Chrome");
	});

	it("passes dpiMode as -DpiMode PowerShell argument when set to logical", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"image":"ZmFrZQ==","title":"Chrome"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		await captureWindow(
			"Chrome",
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"logical",
		);

		const args = execFileMock.mock.calls[0][1] as string[];
		const dpiModeIndex = args.indexOf("-DpiMode");
		expect(dpiModeIndex).toBeGreaterThan(-1);
		expect(args[dpiModeIndex + 1]).toBe("logical");
	});

	it("does not pass -DpiMode when dpiMode is undefined", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"image":"ZmFrZQ==","title":"Chrome"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { captureWindow } = await import("../src/capture.js");
		await captureWindow("Chrome");

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).not.toContain("-DpiMode");
	});
});
