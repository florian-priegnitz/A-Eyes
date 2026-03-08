import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../src/server.js";

const {
	captureWindowMock,
	execFileMock,
	isWindowAllowedMock,
	listWindowsMock,
	loadConfigMock,
	resolveOutputPathMock,
	saveScreenshotMock,
	writeAuditEntryMock,
} = vi.hoisted(() => ({
	captureWindowMock: vi.fn(),
	execFileMock: vi.fn(),
	listWindowsMock: vi.fn(),
	loadConfigMock: vi.fn(),
	isWindowAllowedMock: vi.fn(),
	resolveOutputPathMock: vi.fn(),
	saveScreenshotMock: vi.fn(),
	writeAuditEntryMock: vi.fn(),
}));

vi.mock("../src/capture.js", () => ({
	captureWindow: captureWindowMock,
}));

vi.mock("../src/list-windows.js", () => ({
	listWindows: listWindowsMock,
}));

vi.mock("../src/config.js", () => ({
	loadConfig: loadConfigMock,
	isWindowAllowed: isWindowAllowedMock,
}));

vi.mock("../src/save-screenshot.js", () => ({
	resolveOutputPath: resolveOutputPathMock,
	saveScreenshot: saveScreenshotMock,
}));

vi.mock("../src/audit-log.js", () => ({
	writeAuditEntry: writeAuditEntryMock,
}));

vi.mock("node:child_process", () => ({
	execFile: execFileMock,
}));

type ToolHandler = (args: Record<string, unknown>) => Promise<{
	content: Array<{ type: string; text?: string; mimeType?: string; data?: string }>;
	isError?: boolean;
}>;

function getToolHandler(server: unknown, name: string): ToolHandler {
	const tools = (server as { _registeredTools: Record<string, { handler: ToolHandler }> })
		._registeredTools;
	return tools[name].handler;
}

describe("createServer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		writeAuditEntryMock.mockResolvedValue(undefined);
	});

	it("creates an MCP server instance", () => {
		const server = createServer();
		expect(server).toBeDefined();
		expect(typeof server.tool).toBe("function");
		expect(typeof server.connect).toBe("function");
	});

	it("loads config only once across tool calls", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });
		listWindowsMock.mockResolvedValue({
			windows: [
				{
					title: "Chrome",
					processName: "chrome",
					processId: 1,
					width: 1200,
					height: 800,
					minimized: false,
				},
			],
			count: 1,
		});

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const query = getToolHandler(server, "query");
		const list = getToolHandler(server, "list_windows");

		await capture({ window_title: "Chrome" });
		await query({ window_title: "Chrome", question: "What do you see?" });
		await list({});

		expect(loadConfigMock).toHaveBeenCalledTimes(1);
	});

	it("deduplicates concurrent config loads", async () => {
		let resolveConfig: ((value: Record<string, unknown>) => void) | undefined;
		const configPromise = new Promise<Record<string, unknown>>((resolve) => {
			resolveConfig = resolve;
		});
		loadConfigMock.mockReturnValue(configPromise);
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const query = getToolHandler(server, "query");

		const captureResult = capture({ window_title: "Chrome" });
		const queryResult = query({ window_title: "Chrome", question: "What do you see?" });

		expect(loadConfigMock).toHaveBeenCalledTimes(1);

		resolveConfig?.({});
		await Promise.all([captureResult, queryResult]);

		expect(loadConfigMock).toHaveBeenCalledTimes(1);
	});

	it("blocks capture when window is not allowlisted", async () => {
		loadConfigMock.mockResolvedValue({ allowlist: ["VS Code"] });
		isWindowAllowedMock.mockReturnValue(false);

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const result = await capture({ window_title: "Chrome" });

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("not in the allowlist");
		expect(result.content[0]?.text).toContain("VS Code");
		expect(captureWindowMock).not.toHaveBeenCalled();
	});

	it("blocks capture with config hint when no allowlist configured", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(false);

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const result = await capture({ window_title: "Chrome" });

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("No allowlist configured");
		expect(result.content[0]?.text).toContain("a-eyes.config.json");
		expect(captureWindowMock).not.toHaveBeenCalled();
	});

	it("blocks query with config hint when no allowlist configured", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(false);

		const server = createServer();
		const query = getToolHandler(server, "query");
		const result = await query({ window_title: "Chrome", question: "What?" });

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("No allowlist configured");
		expect(captureWindowMock).not.toHaveBeenCalled();
	});

	it("saves screenshot when output_path is provided", async () => {
		loadConfigMock.mockResolvedValue({ save_screenshots: false, screenshot_dir: "./screenshots" });
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });
		resolveOutputPathMock.mockReturnValue("/tmp/chrome.png");
		saveScreenshotMock.mockResolvedValue("/tmp/chrome.png");

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const result = await capture({ window_title: "Chrome", output_path: "/tmp/chrome.png" });

		expect(saveScreenshotMock).toHaveBeenCalledWith("ZmFrZQ==", "/tmp/chrome.png");
		const text = result.content.find((c) => c.type === "text")?.text ?? "";
		expect(text).toContain("Saved to: /tmp/chrome.png");
	});

	it("saves screenshot when save_screenshots config is enabled", async () => {
		loadConfigMock.mockResolvedValue({
			save_screenshots: true,
			screenshot_dir: "./screenshots",
		});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });
		resolveOutputPathMock.mockReturnValue("./screenshots/Chrome_20260308_120000.png");
		saveScreenshotMock.mockResolvedValue("./screenshots/Chrome_20260308_120000.png");

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const result = await capture({ window_title: "Chrome" });

		expect(resolveOutputPathMock).toHaveBeenCalledWith("./screenshots", "Chrome");
		expect(saveScreenshotMock).toHaveBeenCalled();
		const text = result.content.find((c) => c.type === "text")?.text ?? "";
		expect(text).toContain("Saved to:");
	});

	it("does not save when save_screenshots is false and no output_path", async () => {
		loadConfigMock.mockResolvedValue({ save_screenshots: false, screenshot_dir: "./screenshots" });
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const result = await capture({ window_title: "Chrome" });

		expect(saveScreenshotMock).not.toHaveBeenCalled();
		const text = result.content.find((c) => c.type === "text")?.text ?? "";
		expect(text).not.toContain("Saved to:");
	});

	it("returns screenshot with warning when save fails", async () => {
		loadConfigMock.mockResolvedValue({ save_screenshots: false, screenshot_dir: "./screenshots" });
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });
		resolveOutputPathMock.mockReturnValue("/readonly/chrome.png");
		saveScreenshotMock.mockRejectedValue(new Error("Permission denied"));

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const result = await capture({ window_title: "Chrome", output_path: "/readonly" });

		expect(result.isError).toBeUndefined();
		const imageContent = result.content.find((c) => c.type === "image");
		expect(imageContent?.data).toBe("ZmFrZQ==");
		const text = result.content.find((c) => c.type === "text")?.text ?? "";
		expect(text).toContain("Warning: Failed to save screenshot");
		expect(text).toContain("Permission denied");
	});

	it("logs audit entry on successful capture", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		await capture({ window_title: "Chrome" });

		expect(writeAuditEntryMock).toHaveBeenCalledTimes(1);
		const entry = writeAuditEntryMock.mock.calls[0][0];
		expect(entry.tool).toBe("capture");
		expect(entry.params).toEqual({ window_title: "Chrome" });
		expect(entry.result).toBe("success");
		expect(entry.duration_ms).toBeGreaterThanOrEqual(0);
	});

	it("logs audit entry when capture is blocked", async () => {
		loadConfigMock.mockResolvedValue({ allowlist: ["VS Code"] });
		isWindowAllowedMock.mockReturnValue(false);

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		await capture({ window_title: "Chrome" });

		expect(writeAuditEntryMock).toHaveBeenCalledTimes(1);
		const entry = writeAuditEntryMock.mock.calls[0][0];
		expect(entry.tool).toBe("capture");
		expect(entry.result).toBe("blocked");
		expect(entry.error).toContain("not in the allowlist");
	});

	it("logs audit entry on capture error", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockRejectedValue(new Error("Window not found"));

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		await capture({ window_title: "Chrome" });

		expect(writeAuditEntryMock).toHaveBeenCalledTimes(1);
		const entry = writeAuditEntryMock.mock.calls[0][0];
		expect(entry.tool).toBe("capture");
		expect(entry.result).toBe("error");
		expect(entry.error).toBe("Window not found");
	});

	it("logs audit entry on successful list_windows", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		listWindowsMock.mockResolvedValue({
			windows: [
				{
					title: "Chrome",
					processName: "chrome",
					processId: 1,
					width: 1200,
					height: 800,
					minimized: false,
				},
			],
			count: 1,
		});

		const server = createServer();
		const list = getToolHandler(server, "list_windows");
		await list({});

		expect(writeAuditEntryMock).toHaveBeenCalledTimes(1);
		const entry = writeAuditEntryMock.mock.calls[0][0];
		expect(entry.tool).toBe("list_windows");
		expect(entry.result).toBe("success");
		expect(entry.windows_count).toBe(1);
	});

	it("logs audit entry on successful query", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });

		const server = createServer();
		const query = getToolHandler(server, "query");
		await query({ window_title: "Chrome", question: "What color?" });

		expect(writeAuditEntryMock).toHaveBeenCalledTimes(1);
		const entry = writeAuditEntryMock.mock.calls[0][0];
		expect(entry.tool).toBe("query");
		expect(entry.params).toEqual({ window_title: "Chrome", question: "What color?" });
		expect(entry.result).toBe("success");
	});

	it("logs audit entry when query is blocked", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(false);

		const server = createServer();
		const query = getToolHandler(server, "query");
		await query({ window_title: "Chrome", question: "What?" });

		expect(writeAuditEntryMock).toHaveBeenCalledTimes(1);
		const entry = writeAuditEntryMock.mock.calls[0][0];
		expect(entry.tool).toBe("query");
		expect(entry.result).toBe("blocked");
	});

	it("does not block tool call when audit logging fails", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });
		writeAuditEntryMock.mockRejectedValue(new Error("disk full"));

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const result = await capture({ window_title: "Chrome" });

		expect(result.isError).toBeUndefined();
		expect(result.content.find((c: { type: string }) => c.type === "image")).toBeDefined();
	});

	it("marks list_windows entries as capturable or blocked", async () => {
		loadConfigMock.mockResolvedValue({ allowlist: ["Chrome"] });
		isWindowAllowedMock.mockImplementation((_cfg, title: string) => title.includes("Chrome"));
		listWindowsMock.mockResolvedValue({
			windows: [
				{
					title: "Google Chrome - New Tab",
					processName: "chrome",
					processId: 1,
					width: 1200,
					height: 800,
					minimized: false,
				},
				{
					title: "Mozilla Firefox",
					processName: "firefox",
					processId: 2,
					width: 1100,
					height: 780,
					minimized: false,
				},
			],
			count: 2,
		});

		const server = createServer();
		const list = getToolHandler(server, "list_windows");
		const result = await list({});
		const text = result.content[0]?.text ?? "";

		expect(text).toContain("Found 2 windows:");
		expect(text).toContain("+ Google Chrome - New Tab");
		expect(text).toContain("- Mozilla Firefox");
	});

	it("passes max_width to captureWindow", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		await capture({ window_title: "Chrome", max_width: 800 });

		expect(captureWindowMock).toHaveBeenCalledWith("Chrome", undefined, 800);
	});

	it("passes max_width to captureWindow in query tool", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });

		const server = createServer();
		const query = getToolHandler(server, "query");
		await query({ window_title: "Chrome", question: "What?", max_width: 600 });

		expect(captureWindowMock).toHaveBeenCalledWith("Chrome", undefined, 600);
	});

	it("check_status reports config, interop, and scripts", async () => {
		loadConfigMock.mockResolvedValue({ allowlist: ["Chrome", "VS Code", "Firefox"] });
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, "5.1.22621.4391", "");
		});

		const server = createServer();
		const checkStatus = getToolHandler(server, "check_status");
		const result = await checkStatus({});
		const text = result.content[0]?.text ?? "";

		expect(text).toContain("A-Eyes Status:");
		expect(text).toContain("Config:      OK (3 windows in allowlist)");
		expect(text).toContain("Interop:     OK (PowerShell 5.1.22621.4391)");
		expect(text).toContain("Scripts:     OK");
	});

	it("check_status shows no-allowlist warning", async () => {
		loadConfigMock.mockResolvedValue({});
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, "7.4.0", "");
		});

		const server = createServer();
		const checkStatus = getToolHandler(server, "check_status");
		const result = await checkStatus({});
		const text = result.content[0]?.text ?? "";

		expect(text).toContain("no allowlist — all captures blocked");
	});

	it("check_status reports interop failure", async () => {
		loadConfigMock.mockResolvedValue({});
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(new Error("spawn failed"), "", "Exec format error");
		});

		const server = createServer();
		const checkStatus = getToolHandler(server, "check_status");
		const result = await checkStatus({});
		const text = result.content[0]?.text ?? "";

		expect(text).toContain("Interop:     FAIL");
		expect(text).toContain("Exec format error");
	});

	it("check_status logs audit entry", async () => {
		loadConfigMock.mockResolvedValue({});
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, "5.1", "");
		});

		const server = createServer();
		const checkStatus = getToolHandler(server, "check_status");
		await checkStatus({});

		expect(writeAuditEntryMock).toHaveBeenCalledTimes(1);
		const entry = writeAuditEntryMock.mock.calls[0][0];
		expect(entry.tool).toBe("check_status");
		expect(entry.result).toBe("success");
	});

	it("blocks capture when rate limit is exceeded", async () => {
		loadConfigMock.mockResolvedValue({ max_captures_per_minute: 2 });
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });

		const server = createServer();
		const capture = getToolHandler(server, "capture");

		// First two should succeed
		await capture({ window_title: "Chrome" });
		await capture({ window_title: "Chrome" });

		// Third should be rate limited
		const result = await capture({ window_title: "Chrome" });
		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("Rate limit exceeded");
		expect(result.content[0]?.text).toContain("2 captures per minute");
		expect(captureWindowMock).toHaveBeenCalledTimes(2);
	});

	it("blocks query when rate limit is exceeded", async () => {
		loadConfigMock.mockResolvedValue({ max_captures_per_minute: 1 });
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const query = getToolHandler(server, "query");

		await capture({ window_title: "Chrome" });
		const result = await query({ window_title: "Chrome", question: "What?" });

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("Rate limit exceeded");
	});

	it("logs rate_limited audit entry", async () => {
		loadConfigMock.mockResolvedValue({ max_captures_per_minute: 1 });
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		await capture({ window_title: "Chrome" });
		await capture({ window_title: "Chrome" });

		const rateLimitedEntry = writeAuditEntryMock.mock.calls.find(
			(call) => call[0].result === "rate_limited",
		);
		expect(rateLimitedEntry).toBeDefined();
		expect(rateLimitedEntry[0].tool).toBe("capture");
	});

	it("does not rate-limit list_windows or check_status", async () => {
		loadConfigMock.mockResolvedValue({ max_captures_per_minute: 1 });
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });
		listWindowsMock.mockResolvedValue({ windows: [], count: 0 });
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, "5.1", "");
		});

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const list = getToolHandler(server, "list_windows");
		const checkStatus = getToolHandler(server, "check_status");

		// Use up rate limit
		await capture({ window_title: "Chrome" });

		// These should still work
		const listResult = await list({});
		expect(listResult.isError).toBeUndefined();

		const statusResult = await checkStatus({});
		expect(statusResult.isError).toBeUndefined();
	});
});
