import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLastJsonLine } from "./powershell-output.js";
import { formatPowerShellExecutionError } from "./windows-interop.js";
import { toWindowsPath } from "./windows-path.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export type ClipboardResult =
	| { type: "text"; content: string }
	| { type: "image"; data: string; width: number; height: number }
	| { type: "empty" };

function getScriptPath(): string {
	const scriptPath = resolve(__dirname, "..", "scripts", "clipboard.ps1");
	return toWindowsPath(scriptPath);
}

function buildBaseArgs(winScriptPath: string): string[] {
	return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", winScriptPath];
}

export function readClipboard(timeoutMs = 15000): Promise<ClipboardResult> {
	return new Promise((resolve_, reject) => {
		const winScriptPath = getScriptPath();
		const args = [...buildBaseArgs(winScriptPath), "-Action", "read"];

		const child = execFile(
			"powershell.exe",
			args,
			{
				maxBuffer: 50 * 1024 * 1024,
				timeout: timeoutMs,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error) {
					if (error.killed) {
						reject(new Error(`Clipboard read timed out after ${timeoutMs}ms`));
						return;
					}
					const message = formatPowerShellExecutionError(stderr, error.message);
					reject(new Error(`Clipboard read failed: ${message}`));
					return;
				}

				const output = stdout.trim();
				if (!output) {
					reject(new Error("No output from clipboard script"));
					return;
				}

				try {
					const result = parseLastJsonLine(output) as {
						error?: string;
						type?: string;
						content?: string;
						data?: string;
						width?: number;
						height?: number;
					};

					if (result.error) {
						reject(new Error(result.error));
						return;
					}

					if (result.type === "text") {
						resolve_({ type: "text", content: result.content ?? "" });
					} else if (result.type === "image") {
						resolve_({
							type: "image",
							data: result.data ?? "",
							width: result.width ?? 0,
							height: result.height ?? 0,
						});
					} else {
						resolve_({ type: "empty" });
					}
				} catch (parseErr) {
					reject(new Error(`Failed to parse clipboard output: ${parseErr}`));
				}
			},
		);

		child.stdin?.end();
	});
}

export function writeClipboard(text: string, timeoutMs = 15000): Promise<void> {
	return new Promise((resolve_, reject) => {
		const winScriptPath = getScriptPath();
		const args = [...buildBaseArgs(winScriptPath), "-Action", "write", "-Text", text];

		const child = execFile(
			"powershell.exe",
			args,
			{
				maxBuffer: 1 * 1024 * 1024,
				timeout: timeoutMs,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error) {
					if (error.killed) {
						reject(new Error(`Clipboard write timed out after ${timeoutMs}ms`));
						return;
					}
					const message = formatPowerShellExecutionError(stderr, error.message);
					reject(new Error(`Clipboard write failed: ${message}`));
					return;
				}

				const output = stdout.trim();
				if (!output) {
					reject(new Error("No output from clipboard script"));
					return;
				}

				try {
					const result = parseLastJsonLine(output) as {
						error?: string;
						success?: boolean;
					};

					if (result.error) {
						reject(new Error(result.error));
						return;
					}

					resolve_();
				} catch (parseErr) {
					reject(new Error(`Failed to parse clipboard write output: ${parseErr}`));
				}
			},
		);

		child.stdin?.end();
	});
}

/**
 * Write a base64-encoded image to the Windows clipboard.
 * The base64 is passed via stdin to avoid Windows command-line length limits
 * and to eliminate any injection surface.
 * Security: always call this AFTER redaction has been applied to the base64.
 */
export function writeImageToClipboard(base64: string, timeoutMs = 15000): Promise<void> {
	return new Promise((resolve_, reject) => {
		const winScriptPath = getScriptPath();
		const args = [...buildBaseArgs(winScriptPath), "-Action", "write-image"];

		const child = execFile(
			"powershell.exe",
			args,
			{
				maxBuffer: 1 * 1024 * 1024,
				timeout: timeoutMs,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error) {
					if (error.killed) {
						reject(new Error(`Clipboard image write timed out after ${timeoutMs}ms`));
						return;
					}
					const message = formatPowerShellExecutionError(stderr, error.message);
					reject(new Error(`Clipboard image write failed: ${message}`));
					return;
				}

				const output = stdout.trim();
				if (!output) {
					reject(new Error("No output from clipboard script"));
					return;
				}

				try {
					const result = parseLastJsonLine(output) as {
						error?: string;
						success?: boolean;
					};

					if (result.error) {
						reject(new Error(result.error));
						return;
					}

					resolve_();
				} catch (parseErr) {
					reject(new Error(`Failed to parse clipboard image write output: ${parseErr}`));
				}
			},
		);

		// Pass base64 via stdin to avoid arg-length limits
		child.stdin?.write(base64);
		child.stdin?.end();
	});
}
