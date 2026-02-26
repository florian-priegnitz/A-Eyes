import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { captureWindow } from "./capture.js";
import { type AEyesConfig, isWindowAllowed, loadConfig } from "./config.js";
import { listWindows } from "./list-windows.js";

export function createServer(): McpServer {
	const server = new McpServer({
		name: "a-eyes",
		version: "0.1.0",
	});

	let config: AEyesConfig = {};

	async function ensureConfig(): Promise<AEyesConfig> {
		if (Object.keys(config).length === 0) {
			config = await loadConfig();
		}
		return config;
	}

	// --- capture tool ---
	server.tool(
		"capture",
		"Capture a screenshot of a window by title or app name",
		{
			window_title: z.string().describe("The window title or app name to capture"),
		},
		async ({ window_title }) => {
			const cfg = await ensureConfig();

			if (!isWindowAllowed(cfg, window_title)) {
				return {
					content: [
						{
							type: "text",
							text: `Window "${window_title}" is not in the allowlist. Allowed windows: ${cfg.allowlist?.join(", ")}`,
						},
					],
					isError: true,
				};
			}

			try {
				const result = await captureWindow(window_title);
				return {
					content: [
						{
							type: "image",
							data: result.base64,
							mimeType: "image/png",
						},
						{
							type: "text",
							text: `Screenshot of "${result.windowTitle}" captured successfully.`,
						},
					],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text",
							text: `Failed to capture screenshot: ${message}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	// --- list_windows tool ---
	server.tool("list_windows", "List all visible windows on the Windows desktop", {}, async () => {
		try {
			const result = await listWindows();
			const cfg = await ensureConfig();

			const windows = result.windows.map((w) => {
				const allowed = isWindowAllowed(cfg, w.title);
				return `${allowed ? "+" : "-"} ${w.title} [${w.processName}] (${w.width}x${w.height}${w.minimized ? ", minimized" : ""})`;
			});

			return {
				content: [
					{
						type: "text",
						text: `Found ${result.count} windows:\n\n${windows.join("\n")}\n\n(+ = capturable, - = blocked by allowlist)`,
					},
				],
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [
					{
						type: "text",
						text: `Failed to list windows: ${message}`,
					},
				],
				isError: true,
			};
		}
	});

	// --- query tool ---
	server.tool(
		"query",
		"Capture a screenshot of a window and ask a question about its content",
		{
			window_title: z.string().describe("The window title or app name to capture"),
			question: z.string().describe("Question to answer about the screenshot content"),
		},
		async ({ window_title, question }) => {
			const cfg = await ensureConfig();

			if (!isWindowAllowed(cfg, window_title)) {
				return {
					content: [
						{
							type: "text",
							text: `Window "${window_title}" is not in the allowlist. Allowed windows: ${cfg.allowlist?.join(", ")}`,
						},
					],
					isError: true,
				};
			}

			try {
				const result = await captureWindow(window_title);
				return {
					content: [
						{
							type: "image",
							data: result.base64,
							mimeType: "image/png",
						},
						{
							type: "text",
							text: `Screenshot of "${result.windowTitle}" captured. Please answer the following question about this screenshot:\n\n${question}`,
						},
					],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text",
							text: `Failed to capture screenshot for query: ${message}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	return server;
}
