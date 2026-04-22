import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: execFileMock,
}));

describe("custom-tool module", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("runs a custom tool script and returns JSON output", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"status":"ok","value":42}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { runCustomTool } = await import("../src/custom-tool.js");
		const result = await runCustomTool(
			{
				name: "test_tool",
				description: "Test tool",
				script: "/path/to/test.ps1",
				timeout_ms: 15000,
			},
			{},
		);

		expect(result).toContain('"status": "ok"');
		expect(result).toContain('"value": 42');
	});

	it("passes params as PowerShell arguments", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"result":"done"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { runCustomTool } = await import("../src/custom-tool.js");
		await runCustomTool(
			{
				name: "test_tool",
				description: "Test",
				script: "/path/to/test.ps1",
				timeout_ms: 15000,
			},
			{ name: "chrome", count: "10" },
		);

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).toContain("-name");
		expect(args[args.indexOf("-name") + 1]).toBe("chrome");
		expect(args).toContain("-count");
		expect(args[args.indexOf("-count") + 1]).toBe("10");
	});

	it("returns raw output when not JSON", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, "plain text output", "");
			return { stdin: { end: vi.fn() } };
		});

		const { runCustomTool } = await import("../src/custom-tool.js");
		const result = await runCustomTool(
			{
				name: "test_tool",
				description: "Test",
				script: "/path/to/test.ps1",
				timeout_ms: 15000,
			},
			{},
		);

		expect(result).toBe("plain text output");
	});

	it("returns '(no output)' when script produces nothing", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, "", "");
			return { stdin: { end: vi.fn() } };
		});

		const { runCustomTool } = await import("../src/custom-tool.js");
		const result = await runCustomTool(
			{
				name: "test_tool",
				description: "Test",
				script: "/path/to/test.ps1",
				timeout_ms: 15000,
			},
			{},
		);

		expect(result).toBe("(no output)");
	});

	it("rejects on timeout", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			const err = Object.assign(new Error("timed out"), { killed: true });
			callback(err, "", "");
			return { stdin: { end: vi.fn() } };
		});

		const { runCustomTool } = await import("../src/custom-tool.js");
		await expect(
			runCustomTool(
				{
					name: "slow_tool",
					description: "Test",
					script: "/path/to/slow.ps1",
					timeout_ms: 5000,
				},
				{},
			),
		).rejects.toThrow('Custom tool "slow_tool" timed out after 5000ms');
	});

	it("rejects on execution error", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(new Error("powershell.exe not found"), "", "");
			return { stdin: { end: vi.fn() } };
		});

		const { runCustomTool } = await import("../src/custom-tool.js");
		await expect(
			runCustomTool(
				{
					name: "broken_tool",
					description: "Test",
					script: "/path/to/broken.ps1",
					timeout_ms: 15000,
				},
				{},
			),
		).rejects.toThrow('Custom tool "broken_tool" failed');
	});
});
