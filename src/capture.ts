import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractBase64Payload, parseLastJsonLine } from "./powershell-output.js";
import { formatPowerShellExecutionError } from "./windows-interop.js";
import { toWindowsPath } from "./windows-path.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export interface CaptureResult {
	base64: string;
	windowTitle: string;
	processName?: string;
}

export function captureWindow(
	windowTitle: string | undefined,
	timeoutMs = 30000,
	maxWidth?: number,
	crop?: { x: number; y: number; width: number; height: number },
	processName?: string,
	format?: "png" | "jpeg",
	quality?: number,
): Promise<CaptureResult> {
	return new Promise((resolve_, reject) => {
		const scriptPath = resolve(__dirname, "..", "scripts", "screenshot.ps1");
		const winScriptPath = toWindowsPath(scriptPath);

		const args = [
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			winScriptPath,
		];

		if (windowTitle !== undefined) {
			// execFile passes argv directly; no shell-style quoting required.
			args.push("-WindowTitle", windowTitle);
		}

		if (processName !== undefined) {
			args.push("-ProcessName", processName);
		}

		if (maxWidth !== undefined) {
			args.push("-MaxWidth", String(maxWidth));
		}

		if (crop !== undefined) {
			args.push("-CropX", String(crop.x));
			args.push("-CropY", String(crop.y));
			args.push("-CropWidth", String(crop.width));
			args.push("-CropHeight", String(crop.height));
		}

		if (format !== undefined) {
			args.push("-Format", format.toUpperCase());
		}

		if (quality !== undefined) {
			args.push("-Quality", String(quality));
		}

		const child = execFile(
			"powershell.exe",
			args,
			{
				maxBuffer: 50 * 1024 * 1024, // 50MB for large screenshots
				timeout: timeoutMs,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error) {
					if (error.killed) {
						reject(new Error(`Screenshot capture timed out after ${timeoutMs}ms`));
						return;
					}
					const message = formatPowerShellExecutionError(stderr, error.message);
					reject(new Error(`Screenshot capture failed: ${message}`));
					return;
				}

				const output = stdout.trim();
				if (!output) {
					reject(new Error("No output from screenshot script"));
					return;
				}

				try {
					const result = parseLastJsonLine(output) as {
						error?: string;
						image?: string;
						title?: string;
						processName?: string;
					};
					if (result.error) {
						reject(new Error(result.error));
						return;
					}
					if (!result.image) {
						reject(new Error("Screenshot script output is missing image data"));
						return;
					}
					resolve_({
						base64: result.image,
						windowTitle: result.title || windowTitle || "",
						processName: result.processName || undefined,
					});
				} catch {
					const base64 = extractBase64Payload(output);
					if (!base64) {
						reject(new Error("Failed to parse screenshot output"));
						return;
					}
					resolve_({ base64, windowTitle: windowTitle || "" });
				}
			},
		);

		child.stdin?.end();
	});
}
