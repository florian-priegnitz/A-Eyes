import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** Convert a WSL path to a Windows path */
function toWindowsPath(wslPath: string): string {
	return wslPath
		.replace(/\//g, "\\")
		.replace(/^\\mnt\\(\w)/, (_, drive: string) => `${drive.toUpperCase()}:`);
}

/** Escape a string for safe use as a PowerShell argument */
function escapePowerShellArg(value: string): string {
	// Single-quote the value, escaping any embedded single quotes by doubling them
	return `'${value.replace(/'/g, "''")}'`;
}

export interface CaptureResult {
	base64: string;
	windowTitle: string;
}

export function captureWindow(windowTitle: string, timeoutMs = 30000): Promise<CaptureResult> {
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
			"-WindowTitle",
			escapePowerShellArg(windowTitle),
		];

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
					reject(new Error(`Screenshot capture failed: ${stderr || error.message}`));
					return;
				}

				const output = stdout.trim();
				if (!output) {
					reject(new Error("No output from screenshot script"));
					return;
				}

				// The script outputs JSON with status and data
				try {
					const result = JSON.parse(output);
					if (result.error) {
						reject(new Error(result.error));
						return;
					}
					resolve_({
						base64: result.image,
						windowTitle: result.title || windowTitle,
					});
				} catch {
					// If not JSON, treat the whole output as base64 (fallback)
					resolve_({
						base64: output,
						windowTitle,
					});
				}
			},
		);

		child.stdin?.end();
	});
}
