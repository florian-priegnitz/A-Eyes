import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLastJsonLine } from "./powershell-output.js";
import { formatPowerShellExecutionError } from "./windows-interop.js";
import { toWindowsPath } from "./windows-path.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export interface UIElement {
	id: string;
	type: string;
	name: string;
	value: string;
	enabled: boolean;
	bounds: { x: number; y: number; width: number; height: number };
}

export interface SeeResult {
	windowTitle: string;
	processName: string;
	windowWidth: number;
	windowHeight: number;
	elementCount: number;
	elements: UIElement[];
	text: string;
	image?: string;
}

export function seeWindow(
	windowTitle: string | undefined,
	processName?: string,
	timeoutMs = 30000,
): Promise<SeeResult> {
	return new Promise((resolve_, reject) => {
		const scriptPath = resolve(__dirname, "..", "scripts", "see.ps1");
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
			args.push("-WindowTitle", windowTitle);
		}
		if (processName !== undefined) {
			args.push("-ProcessName", processName);
		}

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
						reject(new Error(`See timed out after ${timeoutMs}ms`));
						return;
					}
					const message = formatPowerShellExecutionError(stderr, error.message);
					reject(new Error(`See failed: ${message}`));
					return;
				}

				const output = stdout.trim();
				if (!output) {
					reject(new Error("No output from see script"));
					return;
				}

				try {
					const result = parseLastJsonLine(output) as {
						error?: string;
						title?: string;
						processName?: string;
						windowWidth?: number;
						windowHeight?: number;
						elementCount?: number;
						elements?: UIElement[];
						text?: string;
						image?: string;
					};

					if (result.error) {
						reject(new Error(result.error));
						return;
					}

					resolve_({
						windowTitle: result.title || windowTitle || "",
						processName: result.processName || processName || "",
						windowWidth: result.windowWidth ?? 0,
						windowHeight: result.windowHeight ?? 0,
						elementCount: result.elementCount ?? 0,
						elements: result.elements ?? [],
						text: result.text ?? "",
						image: result.image || undefined,
					});
				} catch (parseErr) {
					reject(new Error(`Failed to parse see output: ${parseErr}`));
				}
			},
		);

		child.stdin?.end();
	});
}
