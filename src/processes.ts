import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLastJsonLine } from "./powershell-output.js";
import { formatPowerShellExecutionError } from "./windows-interop.js";
import { toWindowsPath } from "./windows-path.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export interface ProcessInfo {
	Id: number;
	ProcessName: string;
	cpu: number;
	memoryMB: number;
	status: string;
	MainWindowTitle: string | null;
}

function getScriptPath(): string {
	const scriptPath = resolve(__dirname, "..", "scripts", "processes.ps1");
	return toWindowsPath(scriptPath);
}

function buildBaseArgs(winScriptPath: string): string[] {
	return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", winScriptPath];
}

export function getProcesses(
	options: { name?: string; limit?: number; sortBy?: "cpu" | "memory" } = {},
	timeoutMs = 15000,
): Promise<ProcessInfo[]> {
	return new Promise((resolve_, reject) => {
		const winScriptPath = getScriptPath();
		const args = [...buildBaseArgs(winScriptPath)];

		if (options.name) {
			args.push("-Name", options.name);
		}
		if (options.limit !== undefined) {
			args.push("-Limit", String(options.limit));
		}
		if (options.sortBy) {
			args.push("-SortBy", options.sortBy);
		}

		const child = execFile(
			"powershell.exe",
			args,
			{
				maxBuffer: 5 * 1024 * 1024,
				timeout: timeoutMs,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error) {
					if (error.killed) {
						reject(new Error(`Process list timed out after ${timeoutMs}ms`));
						return;
					}
					const message = formatPowerShellExecutionError(stderr, error.message);
					reject(new Error(`Failed to get process list: ${message}`));
					return;
				}

				const output = stdout.trim();
				if (!output) {
					reject(new Error("No output from processes script"));
					return;
				}

				try {
					const result = parseLastJsonLine(output) as
						| { error?: string }
						| ProcessInfo[]
						| ProcessInfo;

					if (!Array.isArray(result) && result && "error" in result && result.error) {
						reject(new Error(result.error));
						return;
					}

					// PowerShell returns a single object (not array) when there is only one result
					const list = Array.isArray(result) ? result : [result as ProcessInfo];
					resolve_(list);
				} catch (parseErr) {
					reject(new Error(`Failed to parse processes output: ${parseErr}`));
				}
			},
		);

		child.stdin?.end();
	});
}
