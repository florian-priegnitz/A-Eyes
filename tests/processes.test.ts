import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: execFileMock,
}));

const PROCESS_LIST = [
	{
		Id: 1234,
		ProcessName: "chrome",
		cpu: 12.5,
		memoryMB: 300.0,
		status: "running",
		MainWindowTitle: "Google Chrome",
	},
	{
		Id: 5678,
		ProcessName: "node",
		cpu: 0.0,
		memoryMB: 80.5,
		status: "running",
		MainWindowTitle: null,
	},
];

describe("processes module", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns list of processes", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, JSON.stringify(PROCESS_LIST), "");
			return { stdin: { end: vi.fn() } };
		});

		const { getProcesses } = await import("../src/processes.js");
		const result = await getProcesses();

		expect(result).toHaveLength(2);
		expect(result[0].ProcessName).toBe("chrome");
		expect(result[0].cpu).toBe(12.5);
		expect(result[1].MainWindowTitle).toBeNull();
	});

	it("passes name filter argument to PowerShell", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, JSON.stringify([PROCESS_LIST[0]]), "");
			return { stdin: { end: vi.fn() } };
		});

		const { getProcesses } = await import("../src/processes.js");
		await getProcesses({ name: "chrome" });

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).toContain("-Name");
		expect(args[args.indexOf("-Name") + 1]).toBe("chrome");
	});

	it("passes limit argument to PowerShell", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, JSON.stringify(PROCESS_LIST), "");
			return { stdin: { end: vi.fn() } };
		});

		const { getProcesses } = await import("../src/processes.js");
		await getProcesses({ limit: 10 });

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).toContain("-Limit");
		expect(args[args.indexOf("-Limit") + 1]).toBe("10");
	});

	it("passes sortBy argument to PowerShell", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, JSON.stringify(PROCESS_LIST), "");
			return { stdin: { end: vi.fn() } };
		});

		const { getProcesses } = await import("../src/processes.js");
		await getProcesses({ sortBy: "memory" });

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).toContain("-SortBy");
		expect(args[args.indexOf("-SortBy") + 1]).toBe("memory");
	});

	it("handles single process result (not array) from PowerShell", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, JSON.stringify(PROCESS_LIST[0]), "");
			return { stdin: { end: vi.fn() } };
		});

		const { getProcesses } = await import("../src/processes.js");
		const result = await getProcesses({ name: "chrome" });

		expect(result).toHaveLength(1);
		expect(result[0].ProcessName).toBe("chrome");
	});

	it("handles null CPU values gracefully (cpu field is 0)", async () => {
		const withNullCpu = [{ ...PROCESS_LIST[1], cpu: 0 }];
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, JSON.stringify(withNullCpu), "");
			return { stdin: { end: vi.fn() } };
		});

		const { getProcesses } = await import("../src/processes.js");
		const result = await getProcesses();

		expect(result[0].cpu).toBe(0);
	});

	it("rejects on error JSON from script", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"error":"Access denied"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { getProcesses } = await import("../src/processes.js");
		await expect(getProcesses()).rejects.toThrow("Access denied");
	});

	it("rejects on timeout", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			const err = Object.assign(new Error("timed out"), { killed: true });
			callback(err, "", "");
			return { stdin: { end: vi.fn() } };
		});

		const { getProcesses } = await import("../src/processes.js");
		await expect(getProcesses({}, 5000)).rejects.toThrow("Process list timed out after 5000ms");
	});

	it("rejects on execFile error", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(new Error("powershell.exe not found"), "", "");
			return { stdin: { end: vi.fn() } };
		});

		const { getProcesses } = await import("../src/processes.js");
		await expect(getProcesses()).rejects.toThrow("Failed to get process list");
	});
});
