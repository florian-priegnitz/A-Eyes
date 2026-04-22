import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLastJsonLine } from "./powershell-output.js";
import { formatPowerShellExecutionError } from "./windows-interop.js";
import { toWindowsPath } from "./windows-path.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export interface EventLogEntry {
	timestamp: string;
	level: string;
	provider: string;
	message: string;
}

function getScriptPath(): string {
	const scriptPath = resolve(__dirname, "..", "scripts", "event-log.ps1");
	return toWindowsPath(scriptPath);
}

function buildBaseArgs(winScriptPath: string): string[] {
	return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", winScriptPath];
}

export function getEventLog(
	options: {
		source?: "Application" | "System" | "both";
		count?: number;
		level?: "error" | "warning" | "all";
	} = {},
	timeoutMs = 15000,
): Promise<EventLogEntry[]> {
	return new Promise((resolve_, reject) => {
		const winScriptPath = getScriptPath();
		const args = [...buildBaseArgs(winScriptPath)];

		if (options.source) {
			args.push("-Source", options.source);
		}
		if (options.count !== undefined) {
			args.push("-Count", String(options.count));
		}
		if (options.level) {
			args.push("-Level", options.level);
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
						reject(new Error(`Event log query timed out after ${timeoutMs}ms`));
						return;
					}
					const message = formatPowerShellExecutionError(stderr, error.message);
					reject(new Error(`Failed to read event log: ${message}`));
					return;
				}

				const output = stdout.trim();
				if (!output) {
					resolve_([]);
					return;
				}

				try {
					const result = parseLastJsonLine(output) as
						| { error?: string }
						| EventLogEntry[]
						| EventLogEntry;

					if (!Array.isArray(result) && result && "error" in result && result.error) {
						reject(new Error(result.error));
						return;
					}

					const list = Array.isArray(result) ? result : [result as EventLogEntry];
					resolve_(list);
				} catch (parseErr) {
					reject(new Error(`Failed to parse event log output: ${parseErr}`));
				}
			},
		);

		child.stdin?.end();
	});
}
