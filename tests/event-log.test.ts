import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: execFileMock,
}));

const EVENT_LOG_ENTRIES = [
	{
		timestamp: "2026-03-23T14:30:00.0000000+01:00",
		level: "Error",
		provider: "Application Error",
		message: "Faulting application name: app.exe, version: 1.0.0",
	},
	{
		timestamp: "2026-03-23T14:25:00.0000000+01:00",
		level: "Warning",
		provider: ".NET Runtime",
		message: "Application: dotnet.exe CoreCLR Version: 8.0.0",
	},
];

describe("event-log module", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns list of event log entries", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, JSON.stringify(EVENT_LOG_ENTRIES), "");
			return { stdin: { end: vi.fn() } };
		});

		const { getEventLog } = await import("../src/event-log.js");
		const result = await getEventLog();

		expect(result).toHaveLength(2);
		expect(result[0].level).toBe("Error");
		expect(result[0].provider).toBe("Application Error");
	});

	it("passes source argument to PowerShell", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, JSON.stringify(EVENT_LOG_ENTRIES), "");
			return { stdin: { end: vi.fn() } };
		});

		const { getEventLog } = await import("../src/event-log.js");
		await getEventLog({ source: "System" });

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).toContain("-Source");
		expect(args[args.indexOf("-Source") + 1]).toBe("System");
	});

	it("passes count argument to PowerShell", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, JSON.stringify(EVENT_LOG_ENTRIES), "");
			return { stdin: { end: vi.fn() } };
		});

		const { getEventLog } = await import("../src/event-log.js");
		await getEventLog({ count: 5 });

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).toContain("-Count");
		expect(args[args.indexOf("-Count") + 1]).toBe("5");
	});

	it("passes level argument to PowerShell", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, JSON.stringify(EVENT_LOG_ENTRIES), "");
			return { stdin: { end: vi.fn() } };
		});

		const { getEventLog } = await import("../src/event-log.js");
		await getEventLog({ level: "warning" });

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).toContain("-Level");
		expect(args[args.indexOf("-Level") + 1]).toBe("warning");
	});

	it("handles single entry result (not array) from PowerShell", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, JSON.stringify(EVENT_LOG_ENTRIES[0]), "");
			return { stdin: { end: vi.fn() } };
		});

		const { getEventLog } = await import("../src/event-log.js");
		const result = await getEventLog();

		expect(result).toHaveLength(1);
		expect(result[0].level).toBe("Error");
	});

	it("returns empty array on empty output", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, "", "");
			return { stdin: { end: vi.fn() } };
		});

		const { getEventLog } = await import("../src/event-log.js");
		const result = await getEventLog();

		expect(result).toHaveLength(0);
	});

	it("rejects on error JSON from script", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"error":"Access denied"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { getEventLog } = await import("../src/event-log.js");
		await expect(getEventLog()).rejects.toThrow("Access denied");
	});

	it("rejects on timeout", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			const err = Object.assign(new Error("timed out"), { killed: true });
			callback(err, "", "");
			return { stdin: { end: vi.fn() } };
		});

		const { getEventLog } = await import("../src/event-log.js");
		await expect(getEventLog({}, 5000)).rejects.toThrow("Event log query timed out after 5000ms");
	});

	it("rejects on execFile error", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(new Error("powershell.exe not found"), "", "");
			return { stdin: { end: vi.fn() } };
		});

		const { getEventLog } = await import("../src/event-log.js");
		await expect(getEventLog()).rejects.toThrow("Failed to read event log");
	});
});
