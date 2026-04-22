import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: execFileMock,
}));

describe("list-windows module", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns parsed window list", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(
				null,
				'{"windows":[{"title":"Chrome","processName":"chrome","processId":1,"width":1200,"height":800,"minimized":false,"isActive":false,"windowCount":1}],"count":1}',
				"",
			);
		});

		const { listWindows } = await import("../src/list-windows.js");
		const result = await listWindows();

		expect(result.count).toBe(1);
		expect(result.windows[0]?.title).toBe("Chrome");
	});

	it("rejects with parse error for invalid JSON output", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, "not-json", "");
		});

		const { listWindows } = await import("../src/list-windows.js");
		await expect(listWindows()).rejects.toThrow("Failed to parse window list output");
	});

	it("rejects with timeout error when child process is killed", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			const err = Object.assign(new Error("timed out"), { killed: true });
			callback(err, "", "");
		});

		const { listWindows } = await import("../src/list-windows.js");
		await expect(listWindows(2222)).rejects.toThrow("Window enumeration timed out after 2222ms");
	});

	it("rejects with script stderr when process exits with error", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(new Error("failed"), "", "PowerShell error");
		});

		const { listWindows } = await import("../src/list-windows.js");
		await expect(listWindows()).rejects.toThrow("Window enumeration failed: PowerShell error");
	});

	it("shows actionable message when WSL interop is unavailable", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(
				new Error("spawn failed"),
				"",
				"/mnt/c/.../powershell.exe: cannot execute binary file: Exec format error",
			);
		});

		const { listWindows } = await import("../src/list-windows.js");
		await expect(listWindows()).rejects.toThrow("Windows interop is not available");
	});

	it("parses JSON from last non-empty line", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(
				null,
				'INFO: preparing list\n{"windows":[{"title":"Chrome","processName":"chrome","processId":1,"width":1200,"height":800,"minimized":false,"isActive":false,"windowCount":1}],"count":1}\n',
				"",
			);
		});

		const { listWindows } = await import("../src/list-windows.js");
		const result = await listWindows();
		expect(result.count).toBe(1);
		expect(result.windows[0]?.processName).toBe("chrome");
	});

	// --- isActive / windowCount tests ---

	it("passes through isActive: true from PS output", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(
				null,
				JSON.stringify({
					windows: [
						{
							title: "VS Code",
							processName: "code",
							processId: 42,
							width: 1920,
							height: 1080,
							minimized: false,
							isActive: true,
							windowCount: 1,
						},
					],
					count: 1,
				}),
				"",
			);
		});

		const { listWindows } = await import("../src/list-windows.js");
		const result = await listWindows();

		expect(result.windows[0]?.isActive).toBe(true);
	});

	it("passes through isActive: false from PS output", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(
				null,
				JSON.stringify({
					windows: [
						{
							title: "Notepad",
							processName: "notepad",
							processId: 99,
							width: 800,
							height: 600,
							minimized: false,
							isActive: false,
							windowCount: 1,
						},
					],
					count: 1,
				}),
				"",
			);
		});

		const { listWindows } = await import("../src/list-windows.js");
		const result = await listWindows();

		expect(result.windows[0]?.isActive).toBe(false);
	});

	it("passes through windowCount for a process with multiple windows", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(
				null,
				JSON.stringify({
					windows: [
						{
							title: "Chrome - Tab 1",
							processName: "chrome",
							processId: 10,
							width: 1200,
							height: 800,
							minimized: false,
							isActive: true,
							windowCount: 3,
						},
						{
							title: "Chrome - Tab 2",
							processName: "chrome",
							processId: 10,
							width: 1200,
							height: 800,
							minimized: false,
							isActive: false,
							windowCount: 3,
						},
						{
							title: "Chrome - Tab 3",
							processName: "chrome",
							processId: 10,
							width: 1200,
							height: 800,
							minimized: true,
							isActive: false,
							windowCount: 3,
						},
					],
					count: 3,
				}),
				"",
			);
		});

		const { listWindows } = await import("../src/list-windows.js");
		const result = await listWindows();

		expect(result.count).toBe(3);
		for (const w of result.windows) {
			expect(w.windowCount).toBe(3);
		}
	});

	it("correctly identifies single active window among multiple processes", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(
				null,
				JSON.stringify({
					windows: [
						{
							title: "VS Code",
							processName: "code",
							processId: 1,
							width: 1920,
							height: 1080,
							minimized: false,
							isActive: true,
							windowCount: 1,
						},
						{
							title: "Firefox",
							processName: "firefox",
							processId: 2,
							width: 1280,
							height: 720,
							minimized: false,
							isActive: false,
							windowCount: 1,
						},
						{
							title: "Terminal",
							processName: "wt",
							processId: 3,
							width: 900,
							height: 500,
							minimized: false,
							isActive: false,
							windowCount: 2,
						},
					],
					count: 3,
				}),
				"",
			);
		});

		const { listWindows } = await import("../src/list-windows.js");
		const result = await listWindows();

		const activeWindows = result.windows.filter((w) => w.isActive);
		expect(activeWindows).toHaveLength(1);
		expect(activeWindows[0]?.title).toBe("VS Code");
	});

	it("returns count: 0 and empty windows array for empty result", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, JSON.stringify({ windows: [], count: 0 }), "");
		});

		const { listWindows } = await import("../src/list-windows.js");
		const result = await listWindows();

		expect(result.count).toBe(0);
		expect(result.windows).toHaveLength(0);
	});
});
