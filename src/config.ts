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

export async function loadConfig(configPath?: string): Promise<AEyesConfig> {
	if (configPath) {
		const result = await tryReadConfig(configPath);
		return result ?? DEFAULT_CONFIG;
	}

	// Search chain: cwd → package root → ~/.a-eyes/config.json → defaults
	const cwdConfig = resolve(process.cwd(), "a-eyes.config.json");
	const cwdResult = await tryReadConfig(cwdConfig);
	if (cwdResult) return cwdResult;

	// Package root: one level up from dist/ (where compiled JS lives)
	const pkgConfig = resolve(__dirname, "..", "a-eyes.config.json");
	if (pkgConfig !== cwdConfig) {
		const pkgResult = await tryReadConfig(pkgConfig);
		if (pkgResult) return pkgResult;
	}

	const homeConfig = join(homedir(), ".a-eyes", "config.json");
	const homeResult = await tryReadConfig(homeConfig);
	if (homeResult) return homeResult;

	return DEFAULT_CONFIG;
}

export function isWindowAllowed(config: AEyesConfig, windowTitle: string): boolean {
	if (!config.allowlist || config.allowlist.length === 0) {
		return false;
	}
	const lowerTitle = windowTitle.toLowerCase();
	return config.allowlist.some((pattern) => lowerTitle.includes(pattern.toLowerCase()));
}
