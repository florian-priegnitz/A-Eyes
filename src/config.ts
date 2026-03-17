import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const ConfigSchema = z.object({
	allowlist: z.array(z.string()).optional(),
	save_screenshots: z.boolean().default(false),
	screenshot_dir: z.string().default("./screenshots"),
	max_captures_per_minute: z.number().int().min(0).default(0),
});

export type AEyesConfig = z.infer<typeof ConfigSchema>;

const DEFAULT_CONFIG: AEyesConfig = {
	save_screenshots: false,
	screenshot_dir: "./screenshots",
	max_captures_per_minute: 0,
};

async function tryReadConfig(filePath: string): Promise<AEyesConfig | null> {
	try {
		const raw = await readFile(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		return ConfigSchema.parse(parsed);
	} catch (err) {
		if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		if (err instanceof z.ZodError) {
			throw new Error(
				`Invalid config in ${filePath}: ${err.issues.map((i) => i.message).join(", ")}`,
			);
		}
		throw err;
	}
}

export interface ConfigLoadResult {
	config: AEyesConfig;
	path: string | null;
}

export async function loadConfigWithPath(configPath?: string): Promise<ConfigLoadResult> {
	if (configPath) {
		const result = await tryReadConfig(configPath);
		return { config: result ?? DEFAULT_CONFIG, path: result ? configPath : null };
	}

	// Search chain: cwd → package root → ~/.a-eyes/config.json → defaults
	const cwdConfig = resolve(process.cwd(), "a-eyes.config.json");
	const cwdResult = await tryReadConfig(cwdConfig);
	if (cwdResult) return { config: cwdResult, path: cwdConfig };

	// Package root: one level up from dist/ (where compiled JS lives)
	const pkgConfig = resolve(__dirname, "..", "a-eyes.config.json");
	if (pkgConfig !== cwdConfig) {
		const pkgResult = await tryReadConfig(pkgConfig);
		if (pkgResult) return { config: pkgResult, path: pkgConfig };
	}

	const homeConfig = join(homedir(), ".a-eyes", "config.json");
	const homeResult = await tryReadConfig(homeConfig);
	if (homeResult) return { config: homeResult, path: homeConfig };

	return { config: DEFAULT_CONFIG, path: null };
}

export async function loadConfig(configPath?: string): Promise<AEyesConfig> {
	const { config } = await loadConfigWithPath(configPath);
	return config;
}

export function isWindowAllowed(
	config: AEyesConfig,
	windowTitle?: string,
	processName?: string,
): boolean {
	if (!config.allowlist || config.allowlist.length === 0) {
		return false;
	}
	// Screen captures use the sentinel title "__screen__" and require an exact allowlist entry.
	if (windowTitle === "__screen__") {
		return config.allowlist.includes("__screen__");
	}
	const lowerTitle = windowTitle?.toLowerCase() ?? "";
	const lowerProcess = processName?.toLowerCase() ?? "";
	return config.allowlist.some((pattern) => {
		const lowerPattern = pattern.toLowerCase();
		return (
			(lowerTitle !== "" && lowerTitle.includes(lowerPattern)) ||
			(lowerProcess !== "" && lowerProcess.includes(lowerPattern))
		);
	});
}
