import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeAuditEntry } from "./audit-log.js";
import { captureWindow } from "./capture.js";
import { type AEyesConfig, isWindowAllowed, loadConfig } from "./config.js";
import { listWindows } from "./list-windows.js";
import { resolveOutputPath, saveScreenshot } from "./save-screenshot.js";

export function createServer(): McpServer {
	const server = new McpServer({
		name: "a-eyes",
		version: "0.1.0",
	});

	let config: AEyesConfig = { save_screenshots: false, screenshot_dir: "./screenshots" };
	let configLoaded = false;
	let configLoadPromise: Promise<AEyesConfig> | null = null;

	async function ensureConfig(): Promise<AEyesConfig> {
		if (configLoaded) {
			return config;
		}

		if (!configLoadPromise) {
			configLoadPromise = loadConfig();
		}

		try {
			config = await configLoadPromise;
			configLoaded = true;
			return config;
		} finally {
			configLoadPromise = null;
		}
	}

	// --- capture tool ---
	server.tool(
		"capture",
		"Capture a screenshot of a window by title or app name",
		{
			window_title: z.string().describe("The window title or app name to capture"),
			output_path: z
				.string()
				.optional()
				.describe("Optional file path or directory to save the screenshot PNG to"),
		},
		async ({ window_title, output_path }) => {
			const startTime = Date.now();
			const cfg = await ensureConfig();

			if (!isWindowAllowed(cfg, window_title)) {
				const message =
					!cfg.allowlist || cfg.allowlist.length === 0
						? "No allowlist configured. Add an allowlist to a-eyes.config.json to enable captures."
						: `Window "${window_title}" is not in the allowlist. Allowed windows: ${cfg.allowlist.join(", ")}`;
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "capture",
					params: { window_title },
					result: "blocked",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}

			try {
				const result = await captureWindow(window_title);

				// Determine if/where to save
				let savedPath: string | undefined;
				let saveWarning: string | undefined;
				const saveTo = output_path ?? (cfg.save_screenshots ? cfg.screenshot_dir : undefined);

				if (saveTo) {
					try {
						const resolvedPath = resolveOutputPath(saveTo, result.windowTitle);
						savedPath = await saveScreenshot(result.base64, resolvedPath);
					} catch (saveErr) {
						const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
						saveWarning = `Warning: Failed to save screenshot to file: ${msg}`;
					}
				}

				let statusText = `Screenshot of "${result.windowTitle}" captured successfully.`;
				if (savedPath) {
					statusText += ` Saved to: ${savedPath}`;
				}
				if (saveWarning) {
					statusText += ` ${saveWarning}`;
				}

				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "capture",
					params: { window_title },
					result: "success",
					duration_ms: Date.now() - startTime,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [
						{
							type: "image",
							data: result.base64,
							mimeType: "image/png",
						},
						{
							type: "text",
							text: statusText,
						},
					],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "capture",
					params: { window_title },
					result: "error",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((auditErr) => console.error("Audit log error:", auditErr));
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
		const startTime = Date.now();
		try {
			const result = await listWindows();
			const cfg = await ensureConfig();

			const windows = result.windows.map((w) => {
				const allowed = isWindowAllowed(cfg, w.title);
				return `${allowed ? "+" : "-"} ${w.title} [${w.processName}] (${w.width}x${w.height}${w.minimized ? ", minimized" : ""})`;
			});

			writeAuditEntry({
				timestamp: new Date(startTime).toISOString(),
				tool: "list_windows",
				params: {},
				result: "success",
				duration_ms: Date.now() - startTime,
				windows_count: result.count,
			}).catch((err) => console.error("Audit log error:", err));
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
			writeAuditEntry({
				timestamp: new Date(startTime).toISOString(),
				tool: "list_windows",
				params: {},
				result: "error",
				duration_ms: Date.now() - startTime,
				error: message,
			}).catch((auditErr) => console.error("Audit log error:", auditErr));
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
			const startTime = Date.now();
			const cfg = await ensureConfig();

			if (!isWindowAllowed(cfg, window_title)) {
				const message =
					!cfg.allowlist || cfg.allowlist.length === 0
						? "No allowlist configured. Add an allowlist to a-eyes.config.json to enable captures."
						: `Window "${window_title}" is not in the allowlist. Allowed windows: ${cfg.allowlist.join(", ")}`;
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "query",
					params: { window_title, question },
					result: "blocked",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}

			try {
				const result = await captureWindow(window_title);
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "query",
					params: { window_title, question },
					result: "success",
					duration_ms: Date.now() - startTime,
				}).catch((err) => console.error("Audit log error:", err));
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
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "query",
					params: { window_title, question },
					result: "error",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((auditErr) => console.error("Audit log error:", auditErr));
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
