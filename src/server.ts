import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeAuditEntry } from "./audit-log.js";
import { captureWindow } from "./capture.js";
import { type AEyesConfig, isWindowAllowed, loadConfig } from "./config.js";
import { runHealthCheck } from "./health-check.js";
import { listWindows } from "./list-windows.js";
import { RateLimiter } from "./rate-limiter.js";
import { resolveOutputPath, saveScreenshot } from "./save-screenshot.js";
import { seeWindow } from "./see.js";
import { detectExistingConfig, writeConfig } from "./setup.js";

export function createServer(): McpServer {
	const server = new McpServer({
		name: "a-eyes",
		version: "0.1.0",
	});

	let config: AEyesConfig = {
		save_screenshots: false,
		screenshot_dir: "./screenshots",
		max_captures_per_minute: 0,
	};
	let configLoaded = false;
	let configLoadPromise: Promise<AEyesConfig> | null = null;
	let rateLimiter = new RateLimiter(0);

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
			rateLimiter = new RateLimiter(config.max_captures_per_minute ?? 0);
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
			window_title: z.string().optional().describe("The window title or app name to capture"),
			process_name: z
				.string()
				.optional()
				.describe(
					"The process name to capture (e.g. 'chrome', 'Unity'). More stable than window titles which change dynamically.",
				),
			output_path: z
				.string()
				.optional()
				.describe("Optional file path or directory to save the screenshot PNG to"),
			max_width: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Maximum image width in pixels. If set, wider screenshots are proportionally scaled down.",
				),
			crop: z
				.object({
					x: z.number().int().nonnegative(),
					y: z.number().int().nonnegative(),
					width: z.number().int().nonnegative(),
					height: z.number().int().nonnegative(),
				})
				.optional()
				.describe(
					"Optional region to crop from the captured window. Coordinates are relative to the window. Values exceeding window dimensions are clamped.",
				),
			format: z
				.enum(["png", "jpeg"])
				.optional()
				.describe("Image format: 'png' (default, lossless) or 'jpeg' (smaller, lossy)"),
			quality: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe("JPEG quality 1-100 (default: 85). Ignored for PNG."),
		},
		async ({ window_title, process_name, output_path, max_width, crop, format, quality }) => {
			const startTime = Date.now();

			if (!window_title && !process_name) {
				const message = "At least one of window_title or process_name must be provided.";
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "capture",
					params: { window_title, process_name },
					result: "error",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}

			const cfg = await ensureConfig();

			if (!isWindowAllowed(cfg, window_title, process_name)) {
				const message =
					!cfg.allowlist || cfg.allowlist.length === 0
						? "No allowlist configured. Use the setup tool to create one, or add an allowlist manually to a-eyes.config.json."
						: `Window "${window_title ?? process_name}" is not in the allowlist. Allowed windows: ${cfg.allowlist.join(", ")}`;
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "capture",
					params: { window_title, process_name },
					result: "blocked",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}

			if (!rateLimiter.isAllowed()) {
				const retryAfter = rateLimiter.retryAfterSeconds();
				const message = `Rate limit exceeded: maximum ${cfg.max_captures_per_minute} captures per minute. Try again in ${retryAfter} seconds.`;
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "capture",
					params: { window_title, process_name },
					result: "rate_limited",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}

			try {
				rateLimiter.record();
				const result = await captureWindow(
					window_title,
					undefined,
					max_width,
					crop,
					process_name,
					format,
					quality,
				);

				// Determine if/where to save
				let savedPath: string | undefined;
				let saveWarning: string | undefined;
				const saveTo = output_path ?? (cfg.save_screenshots ? cfg.screenshot_dir : undefined);

				if (saveTo) {
					try {
						const resolvedPath = resolveOutputPath(saveTo, result.windowTitle, format);
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
					params: { window_title, process_name },
					result: "success",
					duration_ms: Date.now() - startTime,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [
						{
							type: "image",
							data: result.base64,
							mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
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
					params: { window_title, process_name },
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
			window_title: z.string().optional().describe("The window title or app name to capture"),
			process_name: z
				.string()
				.optional()
				.describe(
					"The process name to capture (e.g. 'chrome', 'Unity'). More stable than window titles which change dynamically.",
				),
			question: z.string().describe("Question to answer about the screenshot content"),
			max_width: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Maximum image width in pixels. If set, wider screenshots are proportionally scaled down.",
				),
			crop: z
				.object({
					x: z.number().int().nonnegative(),
					y: z.number().int().nonnegative(),
					width: z.number().int().nonnegative(),
					height: z.number().int().nonnegative(),
				})
				.optional()
				.describe(
					"Optional region to crop from the captured window. Coordinates are relative to the window. Values exceeding window dimensions are clamped.",
				),
			format: z
				.enum(["png", "jpeg"])
				.optional()
				.describe("Image format: 'png' (default, lossless) or 'jpeg' (smaller, lossy)"),
			quality: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe("JPEG quality 1-100 (default: 85). Ignored for PNG."),
		},
		async ({ window_title, process_name, question, max_width, crop, format, quality }) => {
			const startTime = Date.now();

			if (!window_title && !process_name) {
				const message = "At least one of window_title or process_name must be provided.";
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "query",
					params: { window_title, process_name, question },
					result: "error",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}

			const cfg = await ensureConfig();

			if (!isWindowAllowed(cfg, window_title, process_name)) {
				const message =
					!cfg.allowlist || cfg.allowlist.length === 0
						? "No allowlist configured. Use the setup tool to create one, or add an allowlist manually to a-eyes.config.json."
						: `Window "${window_title ?? process_name}" is not in the allowlist. Allowed windows: ${cfg.allowlist.join(", ")}`;
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "query",
					params: { window_title, process_name, question },
					result: "blocked",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}

			if (!rateLimiter.isAllowed()) {
				const retryAfter = rateLimiter.retryAfterSeconds();
				const message = `Rate limit exceeded: maximum ${cfg.max_captures_per_minute} captures per minute. Try again in ${retryAfter} seconds.`;
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "query",
					params: { window_title, process_name, question },
					result: "rate_limited",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}

			try {
				rateLimiter.record();
				const result = await captureWindow(
					window_title,
					undefined,
					max_width,
					crop,
					process_name,
					format,
					quality,
				);
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "query",
					params: { window_title, process_name, question },
					result: "success",
					duration_ms: Date.now() - startTime,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [
						{
							type: "image",
							data: result.base64,
							mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
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
					params: { window_title, process_name, question },
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

	// --- see tool ---
	server.tool(
		"see",
		"Capture a window and return its UI element tree (buttons, text fields, labels, etc.) plus a screenshot. Use this to understand what is visible in an application without asking a specific question.",
		{
			window_title: z.string().optional().describe("The window title or app name to inspect"),
			process_name: z
				.string()
				.optional()
				.describe(
					"The process name to inspect (e.g. 'chrome', 'notepad'). More stable than window titles.",
				),
		},
		async ({ window_title, process_name }) => {
			const startTime = Date.now();

			if (!window_title && !process_name) {
				const message = "At least one of window_title or process_name must be provided.";
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "see",
					params: { window_title, process_name },
					result: "error",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}

			const cfg = await ensureConfig();

			if (!isWindowAllowed(cfg, window_title, process_name)) {
				const message =
					!cfg.allowlist || cfg.allowlist.length === 0
						? "No allowlist configured. Use the setup tool to create one, or add an allowlist manually to a-eyes.config.json."
						: `Window "${window_title ?? process_name}" is not in the allowlist. Allowed windows: ${cfg.allowlist.join(", ")}`;
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "see",
					params: { window_title, process_name },
					result: "blocked",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}

			if (!rateLimiter.isAllowed()) {
				const retryAfter = rateLimiter.retryAfterSeconds();
				const message = `Rate limit exceeded: maximum ${cfg.max_captures_per_minute} captures per minute. Try again in ${retryAfter} seconds.`;
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "see",
					params: { window_title, process_name },
					result: "rate_limited",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}

			try {
				rateLimiter.record();
				const result = await seeWindow(window_title, process_name);

				// Format element list as readable text
				const elementLines = result.elements.slice(0, 50).map((el) => {
					const parts = [`[${el.type}]`, `"${el.name}"`];
					if (el.value) parts.push(`value="${el.value}"`);
					if (!el.enabled) parts.push("(disabled)");
					parts.push(`at (${el.bounds.x},${el.bounds.y} ${el.bounds.width}x${el.bounds.height})`);
					return `  ${el.id}: ${parts.join(" ")}`;
				});

				const truncated =
					result.elementCount > 50
						? `\n  ... and ${result.elementCount - 50} more elements`
						: "";

				let summaryText =
					`Window: "${result.windowTitle}" [${result.processName}] — ${result.windowWidth}x${result.windowHeight}\n` +
					`UI Elements (${result.elementCount} total):\n` +
					(elementLines.length > 0 ? elementLines.join("\n") + truncated : "  (none found)");

				if (result.text) {
					summaryText += `\n\nVisible text:\n  ${result.text}`;
				}

				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "see",
					params: { window_title, process_name },
					result: "success",
					duration_ms: Date.now() - startTime,
				}).catch((err) => console.error("Audit log error:", err));

				if (result.image) {
					return {
						content: [
							{ type: "image" as const, data: result.image, mimeType: "image/png" },
							{ type: "text" as const, text: summaryText },
						],
					};
				}

				return {
					content: [{ type: "text" as const, text: summaryText }],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "see",
					params: { window_title, process_name },
					result: "error",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((auditErr) => console.error("Audit log error:", auditErr));
				return {
					content: [{ type: "text", text: `Failed to inspect window: ${message}` }],
					isError: true,
				};
			}
		},
	);

	// --- check_status tool ---
	server.tool(
		"check_status",
		"Check A-Eyes health: config, WSL interop, and script availability",
		{},
		async () => {
			const startTime = Date.now();
			const { lines } = await runHealthCheck();

			writeAuditEntry({
				timestamp: new Date(startTime).toISOString(),
				tool: "check_status",
				params: {},
				result: "success",
				duration_ms: Date.now() - startTime,
			}).catch((err) => console.error("Audit log error:", err));

			return {
				content: [{ type: "text", text: lines.join("\n") }],
			};
		},
	);

	// --- setup tool ---
	server.tool(
		"setup",
		"Interactive setup: preview open windows and create an allowlist config. Call without parameters to preview, or with an allowlist to write the config.",
		{
			allowlist: z
				.array(z.string())
				.optional()
				.describe(
					"Window title patterns to allow for capture. Omit to preview current windows and config status.",
				),
		},
		async ({ allowlist }) => {
			const startTime = Date.now();

			if (!allowlist) {
				// Preview mode: show windows + config status
				const configStatus = await detectExistingConfig();
				const lines: string[] = ["A-Eyes Setup\n"];

				// Config status
				if (configStatus.found) {
					lines.push(`Config found: ${configStatus.path} (${configStatus.source})`);
					if (configStatus.hasAllowlist) {
						lines.push(`Current allowlist: ${configStatus.allowlist.join(", ")}`);
					} else {
						lines.push("Config exists but has no allowlist — all captures are blocked.");
					}
				} else {
					lines.push("No config file found. All captures are currently blocked.");
				}

				lines.push("");

				// Window list
				try {
					const result = await listWindows();
					lines.push(`Open windows (${result.count}):\n`);
					for (const w of result.windows) {
						lines.push(`  - ${w.title} [${w.processName}]${w.minimized ? " (minimized)" : ""}`);
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					lines.push(`Could not list windows: ${msg}`);
				}

				lines.push("");
				lines.push("To create a config, call setup again with an allowlist, e.g.:");
				lines.push('  setup(allowlist: ["Chrome", "VS Code"])');

				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "setup",
					params: {},
					result: "success",
					duration_ms: Date.now() - startTime,
				}).catch((err) => console.error("Audit log error:", err));

				return {
					content: [{ type: "text", text: lines.join("\n") }],
				};
			}

			// Write mode: create config
			if (allowlist.length === 0) {
				const message = "Allowlist cannot be empty. Provide at least one window title pattern.";
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "setup",
					params: { allowlist },
					result: "error",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}

			try {
				const configPath = await writeConfig(allowlist);

				// Force config reload on next tool call
				configLoaded = false;
				configLoadPromise = null;

				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "setup",
					params: { allowlist },
					result: "success",
					duration_ms: Date.now() - startTime,
				}).catch((err) => console.error("Audit log error:", err));

				return {
					content: [
						{
							type: "text",
							text: `Config written to ${configPath}\nAllowlist: ${allowlist.join(", ")}\n\nYou can now capture screenshots of windows matching these patterns.`,
						},
					],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "setup",
					params: { allowlist },
					result: "error",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((auditErr) => console.error("Audit log error:", auditErr));
				return {
					content: [
						{
							type: "text",
							text: `Failed to write config: ${message}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	return server;
}
