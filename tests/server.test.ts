import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../src/server.js";

const {
	captureWindowMock,
	detectExistingConfigMock,
	execFileMock,
	isWindowAllowedMock,
	listWindowsMock,
	loadConfigMock,
	loadConfigWithPathMock,
	resolveOutputPathMock,
	saveScreenshotMock,
	seeWindowMock,
	writeAuditEntryMock,
	writeConfigMock,
} = vi.hoisted(() => ({
	captureWindowMock: vi.fn(),
	detectExistingConfigMock: vi.fn(),
	execFileMock: vi.fn(),
	listWindowsMock: vi.fn(),
	loadConfigMock: vi.fn(),
	loadConfigWithPathMock: vi.fn(),
	isWindowAllowedMock: vi.fn(),
	resolveOutputPathMock: vi.fn(),
	saveScreenshotMock: vi.fn(),
	seeWindowMock: vi.fn(),
	writeAuditEntryMock: vi.fn(),
	writeConfigMock: vi.fn(),
}));

vi.mock("../src/capture.js", () => ({
	captureWindow: captureWindowMock,
}));

vi.mock("../src/list-windows.js", () => ({
	listWindows: listWindowsMock,
}));

vi.mock("../src/config.js", () => ({
	loadConfig: loadConfigMock,
	loadConfigWithPath: loadConfigWithPathMock,
	isWindowAllowed: isWindowAllowedMock,
}));

vi.mock("../src/save-screenshot.js", () => ({
	resolveOutputPath: resolveOutputPathMock,
	saveScreenshot: saveScreenshotMock,
}));

vi.mock("../src/audit-log.js", () => ({
	writeAuditEntry: writeAuditEntryMock,
}));

vi.mock("../src/setup.js", () => ({
	detectExistingConfig: detectExistingConfigMock,
	writeConfig: writeConfigMock,
}));

vi.mock("node:child_process", () => ({
	execFile: execFileMock,
}));

vi.mock("../src/see.js", () => ({
	seeWindow: seeWindowMock,
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
		expect(result.content[0]?.text).toContain("setup tool");
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

		expect(resolveOutputPathMock).toHaveBeenCalledWith("./screenshots", "Chrome", undefined);
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

		expect(captureWindowMock).toHaveBeenCalledWith(
			"Chrome",
			undefined,
			800,
			undefined,
			undefined,
			undefined,
			undefined,
		);
	});

	it("passes crop to captureWindow in capture tool", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Unity" });

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		await capture({ window_title: "Unity", crop: { x: 100, y: 50, width: 400, height: 300 } });

		expect(captureWindowMock).toHaveBeenCalledWith(
			"Unity",
			undefined,
			undefined,
			{
				x: 100,
				y: 50,
				width: 400,
				height: 300,
			},
			undefined,
			undefined,
			undefined,
		);
	});

	it("passes crop to captureWindow in query tool", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Unity" });

		const server = createServer();
		const query = getToolHandler(server, "query");
		await query({
			window_title: "Unity",
			question: "What panel?",
			crop: { x: 0, y: 0, width: 200, height: 150 },
		});

		expect(captureWindowMock).toHaveBeenCalledWith(
			"Unity",
			undefined,
			undefined,
			{
				x: 0,
				y: 0,
				width: 200,
				height: 150,
			},
			undefined,
			undefined,
			undefined,
		);
	});

	it("does not pass crop when omitted", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		await capture({ window_title: "Chrome" });

		expect(captureWindowMock).toHaveBeenCalledWith(
			"Chrome",
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
		);
	});

	it("passes max_width to captureWindow in query tool", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });

		const server = createServer();
		const query = getToolHandler(server, "query");
		await query({ window_title: "Chrome", question: "What?", max_width: 600 });

		expect(captureWindowMock).toHaveBeenCalledWith(
			"Chrome",
			undefined,
			600,
			undefined,
			undefined,
			undefined,
			undefined,
		);
	});

	it("check_status reports version, config with path, interop, and scripts", async () => {
		loadConfigWithPathMock.mockResolvedValue({
			config: { allowlist: ["Chrome", "VS Code", "Firefox"] },
			path: "/home/user/.a-eyes/config.json",
		});
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, "5.1.22621.4391", "");
		});

		const server = createServer();
		const checkStatus = getToolHandler(server, "check_status");
		const result = await checkStatus({});
		const text = result.content[0]?.text ?? "";

		expect(text).toMatch(/A-Eyes v\d+\.\d+\.\d+ Status:/);
		expect(text).toContain("Config:      OK (3 windows in allowlist)");
		expect(text).toContain("[/home/user/.a-eyes/config.json]");
		expect(text).toContain("Interop:     OK (PowerShell 5.1.22621.4391)");
		expect(text).toContain("Scripts:     OK");
	});

	it("check_status shows no-allowlist warning with setup hint", async () => {
		loadConfigWithPathMock.mockResolvedValue({ config: {}, path: null });
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, "7.4.0", "");
		});

		const server = createServer();
		const checkStatus = getToolHandler(server, "check_status");
		const result = await checkStatus({});
		const text = result.content[0]?.text ?? "";

		expect(text).toContain("no allowlist — all captures blocked");
		expect(text).toContain("[defaults]");
		expect(text).toContain("Use the setup tool to create an allowlist");
	});

	it("check_status reports interop failure", async () => {
		loadConfigWithPathMock.mockResolvedValue({ config: {}, path: null });
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
		loadConfigWithPathMock.mockResolvedValue({ config: {}, path: null });
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
		loadConfigWithPathMock.mockResolvedValue({
			config: { max_captures_per_minute: 1 },
			path: null,
		});
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

	// --- process_name tests ---

	it("captures with process_name only", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({
			base64: "ZmFrZQ==",
			windowTitle: "Google Chrome",
			processName: "chrome",
		});

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const result = await capture({ process_name: "chrome" });

		expect(result.isError).toBeUndefined();
		expect(captureWindowMock).toHaveBeenCalledWith(
			undefined,
			undefined,
			undefined,
			undefined,
			"chrome",
			undefined,
			undefined,
		);
		expect(isWindowAllowedMock).toHaveBeenCalledWith(expect.anything(), undefined, "chrome");
	});

	it("captures with both window_title and process_name", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({
			base64: "ZmFrZQ==",
			windowTitle: "Chrome",
			processName: "chrome",
		});

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const result = await capture({ window_title: "Chrome", process_name: "chrome" });

		expect(result.isError).toBeUndefined();
		expect(captureWindowMock).toHaveBeenCalledWith(
			"Chrome",
			undefined,
			undefined,
			undefined,
			"chrome",
			undefined,
			undefined,
		);
	});

	it("returns error when neither window_title nor process_name provided", async () => {
		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const result = await capture({});

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain(
			"At least one of window_title or process_name must be provided",
		);
	});

	it("returns error from query when neither window_title nor process_name provided", async () => {
		const server = createServer();
		const query = getToolHandler(server, "query");
		const result = await query({ question: "What?" });

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain(
			"At least one of window_title or process_name must be provided",
		);
	});

	it("passes process_name to isWindowAllowed for allowlist check", async () => {
		loadConfigMock.mockResolvedValue({ allowlist: ["chrome"] });
		isWindowAllowedMock.mockReturnValue(false);

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		await capture({ process_name: "firefox" });

		expect(isWindowAllowedMock).toHaveBeenCalledWith(expect.anything(), undefined, "firefox");
	});

	it("passes format and quality to captureWindow in capture tool", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const result = await capture({ window_title: "Chrome", format: "jpeg", quality: 75 });

		expect(captureWindowMock).toHaveBeenCalledWith(
			"Chrome",
			undefined,
			undefined,
			undefined,
			undefined,
			"jpeg",
			75,
		);
		const imageContent = result.content.find((c) => c.type === "image");
		expect(imageContent?.mimeType).toBe("image/jpeg");
	});

	it("returns image/png mimeType when format is not set", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		const result = await capture({ window_title: "Chrome" });

		const imageContent = result.content.find((c) => c.type === "image");
		expect(imageContent?.mimeType).toBe("image/png");
	});

	it("passes format and quality to captureWindow in query tool", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });

		const server = createServer();
		const query = getToolHandler(server, "query");
		const result = await query({
			window_title: "Chrome",
			question: "What?",
			format: "jpeg",
			quality: 60,
		});

		expect(captureWindowMock).toHaveBeenCalledWith(
			"Chrome",
			undefined,
			undefined,
			undefined,
			undefined,
			"jpeg",
			60,
		);
		const imageContent = result.content.find((c) => c.type === "image");
		expect(imageContent?.mimeType).toBe("image/jpeg");
	});

	it("passes format to resolveOutputPath for save", async () => {
		loadConfigMock.mockResolvedValue({ save_screenshots: false });
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });
		resolveOutputPathMock.mockReturnValue("/tmp/chrome.jpg");
		saveScreenshotMock.mockResolvedValue("/tmp/chrome.jpg");

		const server = createServer();
		const capture = getToolHandler(server, "capture");
		await capture({ window_title: "Chrome", output_path: "/tmp", format: "jpeg" });

		expect(resolveOutputPathMock).toHaveBeenCalledWith("/tmp", "Chrome", "jpeg");
	});

	it("query with process_name only calls captureWindow correctly", async () => {
		loadConfigMock.mockResolvedValue({});
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({
			base64: "ZmFrZQ==",
			windowTitle: "Unity Editor",
			processName: "Unity",
		});

		const server = createServer();
		const query = getToolHandler(server, "query");
		const result = await query({ process_name: "Unity", question: "What scene?" });

		expect(result.isError).toBeUndefined();
		expect(captureWindowMock).toHaveBeenCalledWith(
			undefined,
			undefined,
			undefined,
			undefined,
			"Unity",
			undefined,
			undefined,
		);
	});

	// --- setup tool tests ---

	it("setup preview shows windows and config status when no config exists", async () => {
		detectExistingConfigMock.mockResolvedValue({
			found: false,
			path: null,
			source: null,
			hasAllowlist: false,
			allowlist: [],
		});
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
				{
					title: "VS Code",
					processName: "code",
					processId: 2,
					width: 1400,
					height: 900,
					minimized: false,
				},
			],
			count: 2,
		});

		const server = createServer();
		const setup = getToolHandler(server, "setup");
		const result = await setup({});
		const text = result.content[0]?.text ?? "";

		expect(text).toContain("No config file found");
		expect(text).toContain("Chrome");
		expect(text).toContain("VS Code");
		expect(text).toContain("Open windows (2)");
		expect(result.isError).toBeUndefined();
	});

	it("setup preview shows existing config with allowlist", async () => {
		detectExistingConfigMock.mockResolvedValue({
			found: true,
			path: "/home/user/.a-eyes/config.json",
			source: "home",
			hasAllowlist: true,
			allowlist: ["Chrome"],
		});
		listWindowsMock.mockResolvedValue({ windows: [], count: 0 });

		const server = createServer();
		const setup = getToolHandler(server, "setup");
		const result = await setup({});
		const text = result.content[0]?.text ?? "";

		expect(text).toContain("Config found:");
		expect(text).toContain("Current allowlist: Chrome");
	});

	it("setup write creates config and forces reload", async () => {
		writeConfigMock.mockResolvedValue("/home/user/.a-eyes/config.json");
		loadConfigMock.mockResolvedValue({ allowlist: ["Chrome"] });
		isWindowAllowedMock.mockReturnValue(true);
		captureWindowMock.mockResolvedValue({ base64: "ZmFrZQ==", windowTitle: "Chrome" });

		const server = createServer();
		const setup = getToolHandler(server, "setup");
		const capture = getToolHandler(server, "capture");

		// Load config initially
		await capture({ window_title: "Chrome" });
		expect(loadConfigMock).toHaveBeenCalledTimes(1);

		// Write new config via setup
		const result = await setup({ allowlist: ["Chrome", "VS Code"] });
		const text = result.content[0]?.text ?? "";

		expect(text).toContain("Config written to");
		expect(text).toContain("Chrome, VS Code");
		expect(writeConfigMock).toHaveBeenCalledWith(["Chrome", "VS Code"]);
		expect(result.isError).toBeUndefined();

		// Next capture should reload config
		await capture({ window_title: "Chrome" });
		expect(loadConfigMock).toHaveBeenCalledTimes(2);
	});

	it("setup write rejects empty allowlist", async () => {
		const server = createServer();
		const setup = getToolHandler(server, "setup");
		const result = await setup({ allowlist: [] });

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("cannot be empty");
		expect(writeConfigMock).not.toHaveBeenCalled();
	});

	it("setup write handles write errors", async () => {
		writeConfigMock.mockRejectedValue(new Error("Permission denied"));

		const server = createServer();
		const setup = getToolHandler(server, "setup");
		const result = await setup({ allowlist: ["Chrome"] });

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("Failed to write config");
		expect(result.content[0]?.text).toContain("Permission denied");
	});

	it("setup logs audit entry", async () => {
		detectExistingConfigMock.mockResolvedValue({
			found: false,
			path: null,
			source: null,
			hasAllowlist: false,
			allowlist: [],
		});
		listWindowsMock.mockResolvedValue({ windows: [], count: 0 });

		const server = createServer();
		const setup = getToolHandler(server, "setup");
		await setup({});

		const setupEntry = writeAuditEntryMock.mock.calls.find((call) => call[0].tool === "setup");
		expect(setupEntry).toBeDefined();
		expect(setupEntry[0].result).toBe("success");
	});

	// --- see tool tests ---

	describe("see tool", () => {
		it("returns error when neither window_title nor process_name provided", async () => {
			const server = createServer();
			const see = getToolHandler(server, "see");
			const result = await see({});

			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain(
				"At least one of window_title or process_name must be provided",
			);
			expect(seeWindowMock).not.toHaveBeenCalled();
		});

		it("returns blocked when window is not in allowlist", async () => {
			loadConfigMock.mockResolvedValue({ allowlist: ["VS Code"] });
			isWindowAllowedMock.mockReturnValue(false);

			const server = createServer();
			const see = getToolHandler(server, "see");
			const result = await see({ window_title: "Chrome" });

			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain("not in the allowlist");
			expect(result.content[0]?.text).toContain("VS Code");
			expect(seeWindowMock).not.toHaveBeenCalled();
		});

		it("returns blocked with setup hint when no allowlist configured", async () => {
			loadConfigMock.mockResolvedValue({});
			isWindowAllowedMock.mockReturnValue(false);

			const server = createServer();
			const see = getToolHandler(server, "see");
			const result = await see({ window_title: "Chrome" });

			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain("No allowlist configured");
			expect(result.content[0]?.text).toContain("setup tool");
			expect(seeWindowMock).not.toHaveBeenCalled();
		});

		it("returns image and element summary on successful call", async () => {
			loadConfigMock.mockResolvedValue({});
			isWindowAllowedMock.mockReturnValue(true);
			seeWindowMock.mockResolvedValue({
				windowTitle: "Notepad",
				processName: "notepad",
				windowWidth: 800,
				windowHeight: 600,
				elementCount: 3,
				elements: [
					{
						id: "elem_0",
						type: "Button",
						name: "OK",
						value: "",
						enabled: true,
						bounds: { x: 100, y: 200, width: 80, height: 30 },
					},
					{
						id: "elem_1",
						type: "Edit",
						name: "Text area",
						value: "Hello",
						enabled: true,
						bounds: { x: 0, y: 0, width: 800, height: 500 },
					},
					{
						id: "elem_2",
						type: "MenuItem",
						name: "File",
						value: "",
						enabled: false,
						bounds: { x: 0, y: 0, width: 40, height: 20 },
					},
				],
				text: "OK Text area Hello File",
				image: "ZmFrZWltYWdl",
			});

			const server = createServer();
			const see = getToolHandler(server, "see");
			const result = await see({ window_title: "Notepad" });

			expect(result.isError).toBeUndefined();

			const imageContent = result.content.find((c) => c.type === "image");
			expect(imageContent?.data).toBe("ZmFrZWltYWdl");
			expect(imageContent?.mimeType).toBe("image/png");

			const textContent = result.content.find((c) => c.type === "text");
			const text = textContent?.text ?? "";
			expect(text).toContain('"Notepad"');
			expect(text).toContain("notepad");
			expect(text).toContain("800x600");
			expect(text).toContain("UI Elements (3 total)");
			expect(text).toContain("elem_0");
			expect(text).toContain("[Button]");
			expect(text).toContain('"OK"');
			expect(text).toContain("elem_1");
			expect(text).toContain('value="Hello"');
			expect(text).toContain("(disabled)");
			expect(text).toContain("Visible text:");
		});

		it("returns summary without image when no image returned", async () => {
			loadConfigMock.mockResolvedValue({});
			isWindowAllowedMock.mockReturnValue(true);
			seeWindowMock.mockResolvedValue({
				windowTitle: "Notepad",
				processName: "notepad",
				windowWidth: 800,
				windowHeight: 600,
				elementCount: 0,
				elements: [],
				text: "",
				image: undefined,
			});

			const server = createServer();
			const see = getToolHandler(server, "see");
			const result = await see({ window_title: "Notepad" });

			expect(result.isError).toBeUndefined();
			expect(result.content.find((c) => c.type === "image")).toBeUndefined();
			const text = result.content.find((c) => c.type === "text")?.text ?? "";
			expect(text).toContain("(none found)");
		});

		it("returns error when seeWindow rejects", async () => {
			loadConfigMock.mockResolvedValue({});
			isWindowAllowedMock.mockReturnValue(true);
			seeWindowMock.mockRejectedValue(new Error("Window not found: 'Notepad'"));

			const server = createServer();
			const see = getToolHandler(server, "see");
			const result = await see({ window_title: "Notepad" });

			expect(result.isError).toBe(true);
			expect(result.content[0]?.text).toContain("Failed to inspect window");
			expect(result.content[0]?.text).toContain("Window not found: 'Notepad'");
		});

		it("calls seeWindow with process_name only", async () => {
			loadConfigMock.mockResolvedValue({});
			isWindowAllowedMock.mockReturnValue(true);
			seeWindowMock.mockResolvedValue({
				windowTitle: "Chrome",
				processName: "chrome",
				windowWidth: 1200,
				windowHeight: 800,
				elementCount: 0,
				elements: [],
				text: "",
				image: undefined,
			});

			const server = createServer();
			const see = getToolHandler(server, "see");
			await see({ process_name: "chrome" });

			expect(seeWindowMock).toHaveBeenCalledWith(undefined, "chrome");
		});

		it("logs audit entry on success", async () => {
			loadConfigMock.mockResolvedValue({});
			isWindowAllowedMock.mockReturnValue(true);
			seeWindowMock.mockResolvedValue({
				windowTitle: "Notepad",
				processName: "notepad",
				windowWidth: 800,
				windowHeight: 600,
				elementCount: 0,
				elements: [],
				text: "",
				image: undefined,
			});

			const server = createServer();
			const see = getToolHandler(server, "see");
			await see({ window_title: "Notepad" });

			expect(writeAuditEntryMock).toHaveBeenCalledTimes(1);
			const entry = writeAuditEntryMock.mock.calls[0][0];
			expect(entry.tool).toBe("see");
			expect(entry.result).toBe("success");
		});

		it("logs audit entry on blocked call", async () => {
			loadConfigMock.mockResolvedValue({ allowlist: ["VS Code"] });
			isWindowAllowedMock.mockReturnValue(false);

			const server = createServer();
			const see = getToolHandler(server, "see");
			await see({ window_title: "Chrome" });

			expect(writeAuditEntryMock).toHaveBeenCalledTimes(1);
			const entry = writeAuditEntryMock.mock.calls[0][0];
			expect(entry.tool).toBe("see");
			expect(entry.result).toBe("blocked");
		});

		it("logs audit entry on error", async () => {
			loadConfigMock.mockResolvedValue({});
			isWindowAllowedMock.mockReturnValue(true);
			seeWindowMock.mockRejectedValue(new Error("See failed"));

			const server = createServer();
			const see = getToolHandler(server, "see");
			await see({ window_title: "Notepad" });

			expect(writeAuditEntryMock).toHaveBeenCalledTimes(1);
			const entry = writeAuditEntryMock.mock.calls[0][0];
			expect(entry.tool).toBe("see");
			expect(entry.result).toBe("error");
			expect(entry.error).toBe("See failed");
		});
	});
});
