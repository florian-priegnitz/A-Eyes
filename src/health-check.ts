import { execFile } from "node:child_process";
import { constants, access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigWithPath } from "./config.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export interface HealthCheckResult {
	lines: string[];
	ok: boolean;
}

export async function runHealthCheck(): Promise<HealthCheckResult> {
	let version = "unknown";
	try {
		const pkgRaw = await readFile(resolve(__dirname, "..", "package.json"), "utf-8");
		version = JSON.parse(pkgRaw).version ?? "unknown";
	} catch {}

	const lines: string[] = [`A-Eyes v${version} Status:`];
	let ok = true;

	// 1. Config
	try {
		const { config, path } = await loadConfigWithPath();
		const count = config.allowlist?.length ?? 0;
		const info =
			count > 0
				? `${count} window${count > 1 ? "s" : ""} in allowlist`
				: "no allowlist — all captures blocked";
		const pathInfo = path ? ` [${path}]` : " [defaults]";
		lines.push(`  Config:      OK (${info})${pathInfo}`);
		if (count === 0) {
			lines.push("               → Use the setup tool to create an allowlist");
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		lines.push(`  Config:      FAIL (${msg})`);
		ok = false;
	}

	// 2. WSL interop
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
		ok = false;
	}

	// 3. Scripts
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
		ok = false;
	}

	return { lines, ok };
}
