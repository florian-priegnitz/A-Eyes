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
				'{"windows":[{"title":"Chrome","processName":"chrome","processId":1,"width":1200,"height":800,"minimized":false}],"count":1}',
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
				'INFO: preparing list\n{"windows":[{"title":"Chrome","processName":"chrome","processId":1,"width":1200,"height":800,"minimized":false}],"count":1}\n',
				"",
			);
		});

		const { listWindows } = await import("../src/list-windows.js");
		const result = await listWindows();
		expect(result.count).toBe(1);
		expect(result.windows[0]?.processName).toBe("chrome");
	});
});
