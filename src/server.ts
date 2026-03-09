import { execFile } from "node:child_process";
import { constants, access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeAuditEntry } from "./audit-log.js";
import { captureWindow } from "./capture.js";
import { type AEyesConfig, isWindowAllowed, loadConfig } from "./config.js";
import { listWindows } from "./list-windows.js";
import { RateLimiter } from "./rate-limiter.js";
import { resolveOutputPath, saveScreenshot } from "./save-screenshot.js";
import { detectExistingConfig, writeConfig } from "./setup.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

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
			window_title: z.string().describe("The window title or app name to capture"),
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
		},
		async ({ window_title, output_path, max_width }) => {
			const startTime = Date.now();
			const cfg = await ensureConfig();

			if (!isWindowAllowed(cfg, window_title)) {
				const message =
					!cfg.allowlist || cfg.allowlist.length === 0
						? "No allowlist configured. Use the setup tool to create one, or add an allowlist manually to a-eyes.config.json."
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

			if (!rateLimiter.isAllowed()) {
				const retryAfter = rateLimiter.retryAfterSeconds();
				const message = `Rate limit exceeded: maximum ${cfg.max_captures_per_minute} captures per minute. Try again in ${retryAfter} seconds.`;
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "capture",
					params: { window_title },
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
				const result = await captureWindow(window_title, undefined, max_width);

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
			max_width: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"Maximum image width in pixels. If set, wider screenshots are proportionally scaled down.",
				),
		},
		async ({ window_title, question, max_width }) => {
			const startTime = Date.now();
			const cfg = await ensureConfig();

			if (!isWindowAllowed(cfg, window_title)) {
				const message =
					!cfg.allowlist || cfg.allowlist.length === 0
						? "No allowlist configured. Use the setup tool to create one, or add an allowlist manually to a-eyes.config.json."
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

			if (!rateLimiter.isAllowed()) {
				const retryAfter = rateLimiter.retryAfterSeconds();
				const message = `Rate limit exceeded: maximum ${cfg.max_captures_per_minute} captures per minute. Try again in ${retryAfter} seconds.`;
				writeAuditEntry({
					timestamp: new Date(startTime).toISOString(),
					tool: "query",
					params: { window_title, question },
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
				const result = await captureWindow(window_title, undefined, max_width);
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

	// --- check_status tool ---
	server.tool(
		"check_status",
		"Check A-Eyes health: config, WSL interop, and script availability",
		{},
		async () => {
			const startTime = Date.now();
			const lines: string[] = ["A-Eyes Status:"];

			// 1. Config check
			let cfg: AEyesConfig;
			try {
				cfg = await ensureConfig();
				const allowlistCount = cfg.allowlist?.length ?? 0;
				const allowlistInfo =
					allowlistCount > 0
						? `${allowlistCount} window${allowlistCount > 1 ? "s" : ""} in allowlist`
						: "no allowlist — all captures blocked";
				lines.push(`  Config:      OK (${allowlistInfo})`);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				lines.push(`  Config:      FAIL (${msg})`);
				cfg = {
					save_screenshots: false,
					screenshot_dir: "./screenshots",
					max_captures_per_minute: 0,
				};
			}

			// 2. WSL interop check
			try {
				const psVersion = await new Promise<string>((resolvePs, rejectPs) => {
					execFile(
						"powershell.exe",
						["-NoProfile", "-Command", "Write-Output $PSVersionTable.PSVersion.ToString()"],
						{ timeout: 10_000 },
						(error, stdout, stderr) => {
							if (error) {
								const stderrMsg = stderr.trim();
								if (stderrMsg.includes("Exec format error")) {
									rejectPs(new Error('Exec format error — run "wsl --shutdown" and restart'));
								} else {
									rejectPs(error);
								}
								return;
							}
							resolvePs(stdout.trim());
						},
					);
				});
				lines.push(`  Interop:     OK (PowerShell ${psVersion})`);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				lines.push(`  Interop:     FAIL (${msg})`);
			}

			// 3. Script availability check
			const scriptsDir = resolve(__dirname, "..", "scripts");
			const scriptNames = ["screenshot.ps1", "list-windows.ps1"];
			const missing: string[] = [];
			for (const name of scriptNames) {
				try {
					await access(resolve(scriptsDir, name), constants.R_OK);
				} catch {
					missing.push(name);
				}
			}
			if (missing.length === 0) {
				lines.push(`  Scripts:     OK (${scriptNames.join(", ")})`);
			} else {
				lines.push(`  Scripts:     FAIL (missing: ${missing.join(", ")})`);
			}

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
