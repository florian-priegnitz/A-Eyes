import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type { CustomTool } from "./config.js";
import { parseLastJsonLine } from "./powershell-output.js";
import { formatPowerShellExecutionError } from "./windows-interop.js";
import { toWindowsPath } from "./windows-path.js";

export async function validateCustomTool(tool: CustomTool): Promise<string | null> {
	try {
		const scriptPath = resolve(tool.script);
		await access(scriptPath);
		return null;
	} catch {
		return `Script not found: ${tool.script}`;
	}
}

export function runCustomTool(tool: CustomTool, params: Record<string, unknown>): Promise<string> {
	return new Promise((resolve_, reject) => {
		const scriptPath = resolve(tool.script);
		const winScriptPath = toWindowsPath(scriptPath);
		const args = [
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			winScriptPath,
		];

		// Pass params as PowerShell arguments
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== null) {
				args.push(`-${key}`, String(value));
			}
		}

		const child = execFile(
			"powershell.exe",
			args,
			{
				maxBuffer: 5 * 1024 * 1024,
				timeout: tool.timeout_ms,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error) {
					if (error.killed) {
						reject(new Error(`Custom tool "${tool.name}" timed out after ${tool.timeout_ms}ms`));
						return;
					}
					const message = formatPowerShellExecutionError(stderr, error.message);
					reject(new Error(`Custom tool "${tool.name}" failed: ${message}`));
					return;
				}

				const output = stdout.trim();
				if (!output) {
					resolve_("(no output)");
					return;
				}

				// Try to parse as JSON for structured output
				try {
					const parsed = parseLastJsonLine(output);
					resolve_(JSON.stringify(parsed, null, 2));
				} catch {
					// Not JSON — return raw output
					resolve_(output);
				}
			},
		);

		child.stdin?.end();
	});
}
