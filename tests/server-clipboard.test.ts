import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	readClipboardMock,
	writeClipboardMock,
	writeAuditEntryMock,
	loadConfigMock,
	isWindowAllowedMock,
} = vi.hoisted(() => ({
	readClipboardMock: vi.fn(),
	writeClipboardMock: vi.fn(),
	writeAuditEntryMock: vi.fn(),
	loadConfigMock: vi.fn(),
	isWindowAllowedMock: vi.fn(),
}));

vi.mock("../src/clipboard.js", () => ({
	readClipboard: readClipboardMock,
	writeClipboard: writeClipboardMock,
}));

vi.mock("../src/audit-log.js", () => ({
	writeAuditEntry: writeAuditEntryMock,
}));

vi.mock("../src/config.js", () => ({
	loadConfig: loadConfigMock,
	isWindowAllowed: isWindowAllowedMock,
}));

vi.mock("../src/capture.js", () => ({ captureWindow: vi.fn() }));
vi.mock("../src/list-windows.js", () => ({ listWindows: vi.fn() }));
vi.mock("../src/see.js", () => ({ seeWindow: vi.fn() }));
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
	content: Array<{ type: string; text?: string; mimeType?: string; data?: string }>;
	isError?: boolean;
}>;

function getToolHandler(server: unknown, name: string): ToolHandler {
	const tools = (server as { _registeredTools: Record<string, { handler: ToolHandler }> })
		._registeredTools;
	return tools[name].handler;
}

describe("server clipboard tool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		writeAuditEntryMock.mockResolvedValue(undefined);
		loadConfigMock.mockResolvedValue({
			save_screenshots: false,
			screenshot_dir: "./screenshots",
			max_captures_per_minute: 0,
		});
	});

	it("read action returns text content", async () => {
		readClipboardMock.mockResolvedValue({ type: "text", content: "copied text" });

		const { createServer } = await import("../src/server.js");
		const server = createServer();
		const clipboard = getToolHandler(server, "clipboard");

		const result = await clipboard({ action: "read" });

		expect(result.isError).toBeFalsy();
		expect(result.content[0]).toMatchObject({ type: "text", text: "copied text" });
		expect(readClipboardMock).toHaveBeenCalledOnce();
	});

	it("read action returns image content", async () => {
		readClipboardMock.mockResolvedValue({
			type: "image",
			data: "ZmFrZQ==",
			width: 1920,
			height: 1080,
		});

		const { createServer } = await import("../src/server.js");
		const server = createServer();
		const clipboard = getToolHandler(server, "clipboard");

		const result = await clipboard({ action: "read" });

		expect(result.isError).toBeFalsy();
		const imageContent = result.content.find((c) => c.type === "image");
		expect(imageContent).toBeDefined();
		expect(imageContent?.data).toBe("ZmFrZQ==");
		expect(imageContent?.mimeType).toBe("image/png");
		const textContent = result.content.find((c) => c.type === "text");
		expect(textContent?.text).toContain("1920x1080");
	});

	it("read action returns empty message when clipboard is empty", async () => {
		readClipboardMock.mockResolvedValue({ type: "empty" });

		const { createServer } = await import("../src/server.js");
		const server = createServer();
		const clipboard = getToolHandler(server, "clipboard");

		const result = await clipboard({ action: "read" });

		expect(result.isError).toBeFalsy();
		expect(result.content[0]).toMatchObject({ type: "text", text: "Clipboard is empty." });
	});

	it("write action with text succeeds", async () => {
		writeClipboardMock.mockResolvedValue(undefined);

		const { createServer } = await import("../src/server.js");
		const server = createServer();
		const clipboard = getToolHandler(server, "clipboard");

		const result = await clipboard({ action: "write", text: "hello" });

		expect(result.isError).toBeFalsy();
		expect(result.content[0].text).toContain("successfully");
		expect(writeClipboardMock).toHaveBeenCalledWith("hello");
	});

	it("write action without text returns error", async () => {
		const { createServer } = await import("../src/server.js");
		const server = createServer();
		const clipboard = getToolHandler(server, "clipboard");

		const result = await clipboard({ action: "write" });

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("text parameter is required");
		expect(writeClipboardMock).not.toHaveBeenCalled();
	});

	it("read action logs audit entry on success", async () => {
		readClipboardMock.mockResolvedValue({ type: "text", content: "test" });

		const { createServer } = await import("../src/server.js");
		const server = createServer();
		const clipboard = getToolHandler(server, "clipboard");

		await clipboard({ action: "read" });

		expect(writeAuditEntryMock).toHaveBeenCalledWith(
			expect.objectContaining({ tool: "clipboard", result: "success" }),
		);
	});

	it("read action logs audit entry on failure", async () => {
		readClipboardMock.mockRejectedValue(new Error("PowerShell unavailable"));

		const { createServer } = await import("../src/server.js");
		const server = createServer();
		const clipboard = getToolHandler(server, "clipboard");

		const result = await clipboard({ action: "read" });

		expect(result.isError).toBe(true);
		expect(writeAuditEntryMock).toHaveBeenCalledWith(
			expect.objectContaining({ tool: "clipboard", result: "error" }),
		);
	});
});
