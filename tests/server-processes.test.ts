import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProcessesMock, writeAuditEntryMock, loadConfigMock, isWindowAllowedMock } = vi.hoisted(
	() => ({
		getProcessesMock: vi.fn(),
		writeAuditEntryMock: vi.fn(),
		loadConfigMock: vi.fn(),
		isWindowAllowedMock: vi.fn(),
	}),
);

vi.mock("../src/processes.js", () => ({
	getProcesses: getProcessesMock,
}));

vi.mock("@a-eyes/security", async () => {
	const actual = await vi.importActual<typeof import("@a-eyes/security")>("@a-eyes/security");
	return {
		...actual,
		writeAuditEntry: writeAuditEntryMock,
	};
});

vi.mock("../src/config.js", () => ({
	loadConfig: loadConfigMock,
	isWindowAllowed: isWindowAllowedMock,
}));

vi.mock("../src/capture.js", () => ({ captureWindow: vi.fn() }));
vi.mock("../src/list-windows.js", () => ({ listWindows: vi.fn() }));
vi.mock("../src/see.js", () => ({ seeWindow: vi.fn() }));
vi.mock("../src/clipboard.js", () => ({
	readClipboard: vi.fn(),
	writeClipboard: vi.fn(),
}));
vi.mock("../src/save-screenshot.js", () => ({
	resolveOutputPath: vi.fn(),
	saveScreenshot: vi.fn(),
}));
vi.mock("../src/setup.js", () => ({
	detectExistingConfig: vi.fn(),
	writeConfig: vi.fn(),
}));
vi.mock("../src/health-check.js", () => ({ runHealthCheck: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
vi.mock("../src/rate-limiter.js", () => ({
	RateLimiter: vi.fn().mockImplementation(() => ({
		isAllowed: vi.fn().mockReturnValue(true),
		record: vi.fn(),
		retryAfterSeconds: vi.fn().mockReturnValue(10),
	})),
}));

type ToolHandler = (args: Record<string, unknown>) => Promise<{
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
}>;

function getToolHandler(server: unknown, name: string): ToolHandler {
	const tools = (server as { _registeredTools: Record<string, { handler: ToolHandler }> })
		._registeredTools;
	return tools[name].handler;
}

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
		cpu: 0.3,
		memoryMB: 80.5,
		status: "running",
		MainWindowTitle: null,
	},
];

describe("server processes tool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		writeAuditEntryMock.mockResolvedValue(undefined);
		loadConfigMock.mockResolvedValue({
			save_screenshots: false,
			screenshot_dir: "./screenshots",
			max_captures_per_minute: 0,
		});
	});

	it("lists all processes and returns text table", async () => {
		getProcessesMock.mockResolvedValue(PROCESS_LIST);

		const { createServer } = await import("../src/server.js");
		const server = createServer();
		const processes = getToolHandler(server, "processes");

		const result = await processes({ limit: 30, sort_by: "cpu" });

		expect(result.isError).toBeFalsy();
		expect(result.content[0].type).toBe("text");
		expect(result.content[0].text).toContain("chrome");
		expect(result.content[0].text).toContain("node");
		expect(result.content[0].text).toContain("Found 2 processes");
	});

	it("filters by name and passes it to getProcesses", async () => {
		getProcessesMock.mockResolvedValue([PROCESS_LIST[0]]);

		const { createServer } = await import("../src/server.js");
		const server = createServer();
		const processes = getToolHandler(server, "processes");

		const result = await processes({ name: "chrome", limit: 30, sort_by: "cpu" });

		expect(result.isError).toBeFalsy();
		expect(getProcessesMock).toHaveBeenCalledWith(expect.objectContaining({ name: "chrome" }));
		expect(result.content[0].text).toContain('filtered by "chrome"');
	});

	it("sorts by memory when sort_by is memory", async () => {
		getProcessesMock.mockResolvedValue(PROCESS_LIST);

		const { createServer } = await import("../src/server.js");
		const server = createServer();
		const processes = getToolHandler(server, "processes");

		await processes({ limit: 30, sort_by: "memory" });

		expect(getProcessesMock).toHaveBeenCalledWith(expect.objectContaining({ sortBy: "memory" }));
	});

	it("logs audit entry on success", async () => {
		getProcessesMock.mockResolvedValue(PROCESS_LIST);

		const { createServer } = await import("../src/server.js");
		const server = createServer();
		const processes = getToolHandler(server, "processes");

		await processes({ limit: 30, sort_by: "cpu" });

		expect(writeAuditEntryMock).toHaveBeenCalledWith(
			expect.objectContaining({ tool: "processes", result: "success" }),
		);
	});

	it("returns error and logs audit entry on failure", async () => {
		getProcessesMock.mockRejectedValue(new Error("PowerShell unavailable"));

		const { createServer } = await import("../src/server.js");
		const server = createServer();
		const processes = getToolHandler(server, "processes");

		const result = await processes({ limit: 30, sort_by: "cpu" });

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Failed to list processes");
		expect(writeAuditEntryMock).toHaveBeenCalledWith(
			expect.objectContaining({ tool: "processes", result: "error" }),
		);
	});
});
