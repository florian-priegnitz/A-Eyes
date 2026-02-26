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

export interface WindowInfo {
	title: string;
	processName: string;
	processId: number;
	width: number;
	height: number;
	minimized: boolean;
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
					reject(new Error(`Window enumeration failed: ${stderr || error.message}`));
					return;
				}

				const output = stdout.trim();
				if (!output) {
					reject(new Error("No output from list-windows script"));
					return;
				}

				try {
					const result = JSON.parse(output);
					if (result.error) {
						reject(new Error(result.error));
						return;
					}
					resolve_({
						windows: result.windows || [],
						count: result.count || 0,
					});
				} catch {
					reject(new Error("Failed to parse window list output"));
				}
			},
		);
	});
}
