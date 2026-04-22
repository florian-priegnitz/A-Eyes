import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLastJsonLine } from "./powershell-output.js";
import { formatPowerShellExecutionError } from "./windows-interop.js";
import { toWindowsPath } from "./windows-path.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export interface WindowInfo {
	title: string;
	processName: string;
	processId: number;
	width: number;
	height: number;
	minimized: boolean;
	isActive: boolean;
	windowCount: number;
}

export interface ListWindowsResult {
	windows: WindowInfo[];
	count: number;
}

export function listWindows(timeoutMs = 15000): Promise<ListWindowsResult> {
	return new Promise((resolve_, reject) => {
		const scriptPath = resolve(__dirname, "..", "scripts", "list-windows.ps1");
		const winScriptPath = toWindowsPath(scriptPath);

		const args = [
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			winScriptPath,
		];

		execFile(
			"powershell.exe",
			args,
			{
				maxBuffer: 10 * 1024 * 1024,
				timeout: timeoutMs,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error) {
					if (error.killed) {
						reject(new Error(`Window enumeration timed out after ${timeoutMs}ms`));
						return;
					}
					const message = formatPowerShellExecutionError(stderr, error.message);
					reject(new Error(`Window enumeration failed: ${message}`));
					return;
				}

				const output = stdout.trim();
				if (!output) {
					reject(new Error("No output from list-windows script"));
					return;
				}

				try {
					const result = parseLastJsonLine(output) as {
						error?: string;
						windows?: WindowInfo[];
						count?: number;
					};
					if (result.error) {
						reject(new Error(result.error));
						return;
					}
					const windows = (result.windows || []).map((w) => ({
						...w,
						isActive: w.isActive ?? false,
						windowCount: w.windowCount ?? 1,
					}));
					resolve_({
						windows,
						count: result.count || 0,
					});
				} catch {
					reject(new Error("Failed to parse window list output"));
				}
			},
		);
	});
}
