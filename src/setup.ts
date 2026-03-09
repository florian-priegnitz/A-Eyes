import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface ConfigDetectionResult {
	found: boolean;
	path: string | null;
	source: "cwd" | "home" | null;
	hasAllowlist: boolean;
	allowlist: string[];
}

/**
 * Detect whether an A-Eyes config file exists in the search chain.
 * Checks cwd/a-eyes.config.json first, then ~/.a-eyes/config.json.
 */
export async function detectExistingConfig(): Promise<ConfigDetectionResult> {
	const cwdPath = resolve(process.cwd(), "a-eyes.config.json");
	const cwdResult = await tryReadConfigFile(cwdPath);
	if (cwdResult) {
		return {
			found: true,
			path: cwdPath,
			source: "cwd",
			hasAllowlist: Array.isArray(cwdResult.allowlist) && cwdResult.allowlist.length > 0,
			allowlist: cwdResult.allowlist ?? [],
		};
	}

	const homePath = join(homedir(), ".a-eyes", "config.json");
	const homeResult = await tryReadConfigFile(homePath);
	if (homeResult) {
		return {
			found: true,
			path: homePath,
			source: "home",
			hasAllowlist: Array.isArray(homeResult.allowlist) && homeResult.allowlist.length > 0,
			allowlist: homeResult.allowlist ?? [],
		};
	}

	return {
		found: false,
		path: null,
		source: null,
		hasAllowlist: false,
		allowlist: [],
	};
}

async function tryReadConfigFile(filePath: string): Promise<{ allowlist?: string[] } | null> {
	try {
		const raw = await readFile(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		return { allowlist: parsed.allowlist };
	} catch {
		return null;
	}
}

/**
 * Write a config file to ~/.a-eyes/config.json with the given allowlist.
 * Creates the ~/.a-eyes/ directory if it doesn't exist.
 * Returns the path of the written config file.
 */
export async function writeConfig(allowlist: string[]): Promise<string> {
	const dir = join(homedir(), ".a-eyes");
	await mkdir(dir, { recursive: true });

	const configPath = join(dir, "config.json");
	const config = { allowlist };
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");

	return configPath;
}
