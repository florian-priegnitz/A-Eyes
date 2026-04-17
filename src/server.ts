import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeAuditEntry } from "./audit-log.js";
import { captureWindow } from "./capture.js";
import { readClipboard, writeClipboard } from "./clipboard.js";
import { type AEyesConfig, isWindowAllowed, loadConfig } from "./config.js";
import { runCustomTool, validateCustomTool } from "./custom-tool.js";
import { getEventLog } from "./event-log.js";
import { runHealthCheck } from "./health-check.js";
import { listWindows } from "./list-windows.js";
import { getProcesses } from "./processes.js";
import { RateLimiter } from "./rate-limiter.js";
import { applyRedactions, findMatchingRules } from "./redact.js";
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
		allow_event_log: false,
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
		"Capture a screenshot of a window by title or app name. Omit both window_title and process_name to capture the currently focused foreground window.",
		{
			window_title: z
				.string()
				.optional()
				.describe(
					"The window title or app name to capture. Omit to capture the foreground window.",
				),
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
			mode: z
				.enum(["window", "screen"])
				.default("window")
				.describe(
					"Capture mode: 'window' (default) captures a specific window, 'screen' captures the full primary monitor. In screen mode, window_title and process_name are ignored. Screen capture requires '__screen__' in the allowlist.",
				),
			dpi_mode: z
				.enum(["native", "logical"])
				.optional()
				.describe(
					"DPI scaling: 'native' (default, raw pixel resolution) or 'logical' (scaled to match visible UI size on HiDPI displays). Reduces payload size on high-DPI monitors.",
				),
		},
		async ({
			window_title,
			process_name,
			output_path,
			max_width,
			crop,
			format,
			quality,
			mode: rawMode,
			dpi_mode,
		}) => {
			const startTime = Date.now();
			const mode = rawMode ?? "window";
			const isScreen = mode === "screen";
			const isFrontmost = !isScreen && !window_title && !process_name;

			const cfg = await ensureConfig();

			// For screen captures, check the allowlist using the __screen__ sentinel.
			if (isScreen && !isWindowAllowed(cfg, "__screen__", undefined)) {
				const message =
					!cfg.allowlist || cfg.allowlist.length === 0
						? "No allowlist configured. Use the setup tool to create one, or add an allowlist manually to a-eyes.config.json."
						: "Screen capture is not enabled. Add '__screen__' to the allowlist in a-eyes.config.json to allow it.";
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "capture",
					params: { mode },
					result: "blocked",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}

			// For named windows, check the allowlist before capturing.
			// For frontmost captures, the allowlist is checked after capture using the returned metadata.
			if (!isScreen && !isFrontmost && !isWindowAllowed(cfg, window_title, process_name)) {
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
					mode,
					dpi_mode,
				);

				// For frontmost captures, check the allowlist against the actual window metadata.
				if (isFrontmost && !isWindowAllowed(cfg, result.windowTitle, result.processName)) {
					const message =
						!cfg.allowlist || cfg.allowlist.length === 0
							? "No allowlist configured. Use the setup tool to create one, or add an allowlist manually to a-eyes.config.json."
							: `Window "${result.windowTitle}" is not in the allowlist. Allowed windows: ${cfg.allowlist.join(", ")}`;
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

				// Apply redaction if rules match
				const redactionRegions = findMatchingRules(cfg, result.windowTitle, result.processName);
				let redactedCount = 0;
				if (redactionRegions.length > 0) {
					const redactionResult = await applyRedactions(result.base64, redactionRegions);
					result.base64 = redactionResult.base64;
					redactedCount = redactionResult.redactedCount;
				}

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

				let statusText = isScreen
					? "Full screen captured successfully."
					: `Screenshot of "${result.windowTitle}" captured successfully.`;
				if (savedPath) {
					statusText += ` Saved to: ${savedPath}`;
				}
				if (saveWarning) {
					statusText += ` ${saveWarning}`;
				}

				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "capture",
					params: { window_title, process_name, mode, dpi_mode },
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
					params: { window_title, process_name, mode, dpi_mode },
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
				const allowedMarker = allowed ? "+" : "-";
				const activeMarker = w.isActive ? "*" : " ";
				const windowCountSuffix = w.windowCount > 1 ? ` (${w.windowCount} windows)` : "";
				return `${allowedMarker}${activeMarker} ${w.title} [${w.processName}] (${w.width}x${w.height}${w.minimized ? ", minimized" : ""})${windowCountSuffix}`;
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
						text: `Found ${result.count} windows:\n\n${windows.join("\n")}\n\n(+ = capturable, - = blocked by allowlist, * = active window, +* = active and capturable)`,
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
		"Capture a screenshot of a window and ask a question about its content. Omit both window_title and process_name to capture the currently focused foreground window.",
		{
			window_title: z
				.string()
				.optional()
				.describe(
					"The window title or app name to capture. Omit to capture the foreground window.",
				),
			process_name: z
				.string()
				.optional()
				.describe(
					"The process name to capture (e.g. 'chrome', 'Unity'). More stable than window titles which change dynamically. Omit to capture the foreground window.",
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
			mode: z
				.enum(["window", "screen"])
				.default("window")
				.describe(
					"Capture mode: 'window' (default) captures a specific window, 'screen' captures the full primary monitor. In screen mode, window_title and process_name are ignored. Screen capture requires '__screen__' in the allowlist.",
				),
			dpi_mode: z
				.enum(["native", "logical"])
				.optional()
				.describe(
					"DPI scaling: 'native' (default, raw pixel resolution) or 'logical' (scaled to match visible UI size on HiDPI displays). Reduces payload size on high-DPI monitors.",
				),
		},
		async ({
			window_title,
			process_name,
			question,
			max_width,
			crop,
			format,
			quality,
			mode: rawMode,
			dpi_mode,
		}) => {
			const startTime = Date.now();
			const mode = rawMode ?? "window";
			const isScreen = mode === "screen";
			const isFrontmost = !isScreen && !window_title && !process_name;

			const cfg = await ensureConfig();

			// For screen captures, check the allowlist using the __screen__ sentinel.
			if (isScreen && !isWindowAllowed(cfg, "__screen__", undefined)) {
				const message =
					!cfg.allowlist || cfg.allowlist.length === 0
						? "No allowlist configured. Use the setup tool to create one, or add an allowlist manually to a-eyes.config.json."
						: "Screen capture is not enabled. Add '__screen__' to the allowlist in a-eyes.config.json to allow it.";
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "query",
					params: { mode, question },
					result: "blocked",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [{ type: "text", text: message }],
					isError: true,
				};
			}

			// For named windows, check the allowlist before capturing.
			// For frontmost captures, the allowlist is checked after capture using the returned metadata.
			if (!isScreen && !isFrontmost && !isWindowAllowed(cfg, window_title, process_name)) {
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
					mode,
					dpi_mode,
				);

				// For frontmost captures, check the allowlist against the actual window metadata.
				if (isFrontmost && !isWindowAllowed(cfg, result.windowTitle, result.processName)) {
					const message =
						!cfg.allowlist || cfg.allowlist.length === 0
							? "No allowlist configured. Use the setup tool to create one, or add an allowlist manually to a-eyes.config.json."
							: `Window "${result.windowTitle}" is not in the allowlist. Allowed windows: ${cfg.allowlist.join(", ")}`;
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

				// Apply redaction if rules match
				const queryRedactionRegions = findMatchingRules(
					cfg,
					result.windowTitle,
					result.processName,
				);
				if (queryRedactionRegions.length > 0) {
					const redactionResult = await applyRedactions(result.base64, queryRedactionRegions);
					result.base64 = redactionResult.base64;
				}

				const captureDescription = isScreen
					? "Full screen"
					: `Screenshot of "${result.windowTitle}"`;
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "query",
					params: { window_title, process_name, question, mode, dpi_mode },
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
							text: `${captureDescription} captured. Please answer the following question about this screenshot:\n\n${question}`,
						},
					],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "query",
					params: { window_title, process_name, question, mode, dpi_mode },
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
		"Capture a window and return its UI element tree (buttons, text fields, labels, etc.) plus a screenshot. Use this to understand what is visible in an application without asking a specific question. Omit both window_title and process_name to inspect the currently focused foreground window.",
		{
			window_title: z
				.string()
				.optional()
				.describe(
					"The window title or app name to inspect. Omit to inspect the foreground window.",
				),
			process_name: z
				.string()
				.optional()
				.describe(
					"The process name to inspect (e.g. 'chrome', 'notepad'). More stable than window titles. Omit to inspect the foreground window.",
				),
			mode: z
				.enum(["full", "text"])
				.default("full")
				.describe(
					"Extraction mode: 'full' (default) returns screenshot + UI element tree + visible text; 'text' returns screenshot + visible text only, skipping the element list for a smaller payload. Both modes walk the element tree internally to harvest nested text.",
				),
		},
		async ({ window_title, process_name, mode: rawMode }) => {
			const mode = rawMode ?? "full";
			const startTime = Date.now();
			const isFrontmost = !window_title && !process_name;

			const cfg = await ensureConfig();

			// For named windows, check the allowlist before capturing.
			// For frontmost captures, the allowlist is checked after capture using the returned metadata.
			if (!isFrontmost && !isWindowAllowed(cfg, window_title, process_name)) {
				const message =
					!cfg.allowlist || cfg.allowlist.length === 0
						? "No allowlist configured. Use the setup tool to create one, or add an allowlist manually to a-eyes.config.json."
						: `Window "${window_title ?? process_name}" is not in the allowlist. Allowed windows: ${cfg.allowlist.join(", ")}`;
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "see",
					params: { window_title, process_name, mode },
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
					params: { window_title, process_name, mode },
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
				const result = await seeWindow(window_title, process_name, 30000, mode);

				// For frontmost captures, check the allowlist against the actual window metadata.
				if (isFrontmost && !isWindowAllowed(cfg, result.windowTitle, result.processName)) {
					const message =
						!cfg.allowlist || cfg.allowlist.length === 0
							? "No allowlist configured. Use the setup tool to create one, or add an allowlist manually to a-eyes.config.json."
							: `Window "${result.windowTitle}" is not in the allowlist. Allowed windows: ${cfg.allowlist.join(", ")}`;
					writeAuditEntry({
						timestamp: new Date(startTime).toISOString(),
						tool: "see",
						params: { window_title, process_name, mode },
						result: "blocked",
						duration_ms: Date.now() - startTime,
						error: message,
					}).catch((err) => console.error("Audit log error:", err));
					return {
						content: [{ type: "text", text: message }],
						isError: true,
					};
				}

				// Format output based on mode
				let summaryText = `Window: "${result.windowTitle}" [${result.processName}] — ${result.windowWidth}x${result.windowHeight}\n`;

				if (mode !== "text") {
					// Format element list as readable text
					const elementLines = result.elements.slice(0, 50).map((el) => {
						const parts = [`[${el.type}]`, `"${el.name}"`];
						if (el.value) parts.push(`value="${el.value}"`);
						if (!el.enabled) parts.push("(disabled)");
						parts.push(`at (${el.bounds.x},${el.bounds.y} ${el.bounds.width}x${el.bounds.height})`);
						return `  ${el.id}: ${parts.join(" ")}`;
					});

					const truncated =
						result.elementCount > 50 ? `\n  ... and ${result.elementCount - 50} more elements` : "";

					summaryText += `UI Elements (${result.elementCount} total):\n${elementLines.length > 0 ? elementLines.join("\n") + truncated : "  (none found)"}`;
				}

				if (result.text) {
					summaryText += `\n\nVisible text:\n  ${result.text}`;
				}

				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "see",
					params: { window_title, process_name, mode },
					result: "success",
					duration_ms: Date.now() - startTime,
				}).catch((err) => console.error("Audit log error:", err));

				if (result.image) {
					// Apply redaction if rules match
					let imageData = result.image;
					const seeRedactionRegions = findMatchingRules(
						cfg,
						result.windowTitle,
						result.processName,
					);
					if (seeRedactionRegions.length > 0) {
						const redactionResult = await applyRedactions(imageData, seeRedactionRegions);
						imageData = redactionResult.base64;
					}

					return {
						content: [
							{ type: "image" as const, data: imageData, mimeType: "image/png" },
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
					params: { window_title, process_name, mode },
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

	// --- clipboard tool ---
	server.tool(
		"clipboard",
		"Read the current Windows clipboard content (text or image), or write text to it. Reading an image returns it as base64 PNG.",
		{
			action: z
				.enum(["read", "write"])
				.default("read")
				.describe("'read' returns current clipboard content, 'write' sets clipboard text"),
			text: z
				.string()
				.optional()
				.describe("Text to write to clipboard (required when action is 'write')"),
		},
		async ({ action, text }) => {
			const startTime = Date.now();

			if (action === "write") {
				if (text === undefined || text === "") {
					const message = "text parameter is required when action is 'write'";
					writeAuditEntry({
						timestamp: new Date(startTime).toISOString(),
						tool: "clipboard",
						params: { action },
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
					await writeClipboard(text);
					writeAuditEntry({
						timestamp: new Date(startTime).toISOString(),
						tool: "clipboard",
						params: { action },
						result: "success",
						duration_ms: Date.now() - startTime,
					}).catch((err) => console.error("Audit log error:", err));
					return {
						content: [{ type: "text", text: "Text written to clipboard successfully." }],
					};
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					writeAuditEntry({
						timestamp: new Date(startTime).toISOString(),
						tool: "clipboard",
						params: { action },
						result: "error",
						duration_ms: Date.now() - startTime,
						error: message,
					}).catch((auditErr) => console.error("Audit log error:", auditErr));
					return {
						content: [{ type: "text", text: `Failed to write to clipboard: ${message}` }],
						isError: true,
					};
				}
			}

			// action === "read"
			try {
				const result = await readClipboard();
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "clipboard",
					params: { action },
					result: "success",
					duration_ms: Date.now() - startTime,
				}).catch((err) => console.error("Audit log error:", err));

				if (result.type === "text") {
					return {
						content: [{ type: "text", text: result.content }],
					};
				}

				if (result.type === "image") {
					return {
						content: [
							{
								type: "image",
								data: result.data,
								mimeType: "image/png",
							},
							{
								type: "text",
								text: `Clipboard image: ${result.width}x${result.height} pixels`,
							},
						],
					};
				}

				// empty
				return {
					content: [{ type: "text", text: "Clipboard is empty." }],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "clipboard",
					params: { action },
					result: "error",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((auditErr) => console.error("Audit log error:", auditErr));
				return {
					content: [{ type: "text", text: `Failed to read clipboard: ${message}` }],
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

	// --- processes tool ---
	server.tool(
		"processes",
		"List running Windows processes with CPU usage, memory, and PID. Useful for diagnosing performance issues or checking if a specific app/service is running. Omit name to get the top processes by CPU.",
		{
			name: z
				.string()
				.optional()
				.describe("Filter by process name (substring match, e.g. 'node', 'chrome')"),
			limit: z
				.number()
				.int()
				.min(1)
				.max(200)
				.default(30)
				.describe("Max processes to return (default: 30)"),
			sort_by: z
				.enum(["cpu", "memory"])
				.default("cpu")
				.describe("Sort by CPU usage or memory (default: cpu)"),
		},
		async ({ name, limit, sort_by }) => {
			const startTime = Date.now();

			try {
				const processes = await getProcesses({ name, limit, sortBy: sort_by });

				const header = "PID      Name                         CPU(s)   Memory(MB)  Status";
				const separator = "------   --------------------------   ------   ----------  ------";
				const rows = processes.map((p) => {
					const pid = String(p.Id).padEnd(8);
					const pname = p.ProcessName.slice(0, 26).padEnd(28);
					const cpu = String(p.cpu).padStart(6);
					const mem = String(p.memoryMB).padStart(10);
					return `${pid} ${pname} ${cpu}   ${mem}  ${p.status}`;
				});

				const tableText = [header, separator, ...rows].join("\n");
				const jsonText = JSON.stringify(processes, null, 2);
				const filterNote = name ? ` (filtered by "${name}")` : "";
				const summaryText =
					`Found ${processes.length} processes${filterNote}, sorted by ${sort_by}:\n\n${tableText}\n\n` +
					`Raw JSON:\n${jsonText}`;

				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "processes",
					params: { name, limit, sort_by },
					result: "success",
					duration_ms: Date.now() - startTime,
				}).catch((err) => console.error("Audit log error:", err));

				return {
					content: [{ type: "text", text: summaryText }],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "processes",
					params: { name, limit, sort_by },
					result: "error",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((auditErr) => console.error("Audit log error:", auditErr));
				return {
					content: [{ type: "text", text: `Failed to list processes: ${message}` }],
					isError: true,
				};
			}
		},
	);

	// --- event_log tool ---
	server.tool(
		"event_log",
		"Read recent entries from the Windows Event Log (Application, System). Useful for diagnosing crashes, service failures, driver issues, and .NET errors. Requires allow_event_log: true in config.",
		{
			source: z
				.enum(["Application", "System", "both"])
				.default("both")
				.describe("Event log source (default: both)"),
			count: z
				.number()
				.int()
				.min(1)
				.max(100)
				.default(20)
				.describe("Max entries to return (default: 20)"),
			level: z
				.enum(["error", "warning", "all"])
				.default("error")
				.describe("Minimum severity level (default: error)"),
		},
		async ({ source, count, level }) => {
			const startTime = Date.now();
			await ensureConfig();

			if (!config.allow_event_log) {
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "event_log",
					params: { source, count, level },
					result: "denied",
					duration_ms: Date.now() - startTime,
					error: "event_log not enabled in config",
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [
						{
							type: "text",
							text: 'Event log access is disabled. Set "allow_event_log": true in a-eyes.config.json to enable.',
						},
					],
					isError: true,
				};
			}

			try {
				const entries = await getEventLog({ source, count, level });

				if (entries.length === 0) {
					writeAuditEntry({
						timestamp: new Date(startTime).toISOString(),
						tool: "event_log",
						params: { source, count, level },
						result: "success",
						duration_ms: Date.now() - startTime,
					}).catch((err) => console.error("Audit log error:", err));
					return {
						content: [
							{
								type: "text",
								text: `No event log entries found (source: ${source}, level: ${level}).`,
							},
						],
					};
				}

				const header =
					"Timestamp                          Level      Provider                         Message";
				const separator =
					"--------------------------------   --------   ------------------------------   --------------------";
				const rows = entries.map((e) => {
					const ts = e.timestamp.slice(0, 23).padEnd(34);
					const lvl = (e.level || "Unknown").slice(0, 8).padEnd(10);
					const prov = (e.provider || "").slice(0, 30).padEnd(32);
					const msg = (e.message || "").split("\n")[0].slice(0, 80);
					return `${ts} ${lvl} ${prov} ${msg}`;
				});

				const tableText = [header, separator, ...rows].join("\n");
				const jsonText = JSON.stringify(entries, null, 2);
				const summaryText = `Found ${entries.length} event log entries (source: ${source}, level: ${level}):\n\n${tableText}\n\nRaw JSON:\n${jsonText}`;

				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "event_log",
					params: { source, count, level },
					result: "success",
					duration_ms: Date.now() - startTime,
				}).catch((err) => console.error("Audit log error:", err));

				return {
					content: [{ type: "text", text: summaryText }],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "event_log",
					params: { source, count, level },
					result: "error",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((auditErr) => console.error("Audit log error:", auditErr));
				return {
					content: [{ type: "text", text: `Failed to read event log: ${message}` }],
					isError: true,
				};
			}
		},
	);

	// --- run_custom tool ---
	server.tool(
		"run_custom",
		"Run a custom PowerShell tool registered in a-eyes.config.json. Use list_custom_tools to see available tools.",
		{
			tool_name: z.string().describe("Name of the custom tool to run"),
			params: z
				.record(z.union([z.string(), z.number(), z.boolean()]))
				.optional()
				.default({})
				.describe("Parameters to pass to the tool script"),
		},
		async ({ tool_name, params }) => {
			const startTime = Date.now();
			const cfg = await ensureConfig();

			if (!cfg.custom_tools || cfg.custom_tools.length === 0) {
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "run_custom",
					params: { tool_name },
					result: "denied",
					duration_ms: Date.now() - startTime,
					error: "No custom tools configured",
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [
						{
							type: "text",
							text: "No custom tools configured. Add custom_tools to a-eyes.config.json.",
						},
					],
					isError: true,
				};
			}

			const tool = cfg.custom_tools.find((t) => t.name === tool_name);
			if (!tool) {
				const available = cfg.custom_tools.map((t) => t.name).join(", ");
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "run_custom",
					params: { tool_name },
					result: "error",
					duration_ms: Date.now() - startTime,
					error: `Tool "${tool_name}" not found`,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [
						{
							type: "text",
							text: `Custom tool "${tool_name}" not found. Available: ${available}`,
						},
					],
					isError: true,
				};
			}

			const validationError = await validateCustomTool(tool);
			if (validationError) {
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "run_custom",
					params: { tool_name, ...params },
					result: "error",
					duration_ms: Date.now() - startTime,
					error: validationError,
				}).catch((err) => console.error("Audit log error:", err));
				return {
					content: [{ type: "text", text: validationError }],
					isError: true,
				};
			}

			try {
				const output = await runCustomTool(tool, params);

				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "run_custom",
					params: { tool_name, ...params },
					result: "success",
					duration_ms: Date.now() - startTime,
				}).catch((err) => console.error("Audit log error:", err));

				return {
					content: [{ type: "text", text: output }],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "run_custom",
					params: { tool_name, ...params },
					result: "error",
					duration_ms: Date.now() - startTime,
					error: message,
				}).catch((auditErr) => console.error("Audit log error:", auditErr));
				return {
					content: [{ type: "text", text: `Custom tool failed: ${message}` }],
					isError: true,
				};
			}
		},
	);

	return server;
}
