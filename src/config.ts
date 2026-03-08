import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const ConfigSchema = z.object({
	allowlist: z.array(z.string()).optional(),
	save_screenshots: z.boolean().default(false),
	screenshot_dir: z.string().default("./screenshots"),
});

export type AEyesConfig = z.infer<typeof ConfigSchema>;

const DEFAULT_CONFIG: AEyesConfig = {
	save_screenshots: false,
	screenshot_dir: "./screenshots",
};

export async function loadConfig(configPath?: string): Promise<AEyesConfig> {
	const filePath = configPath ?? resolve(process.cwd(), "a-eyes.config.json");

	try {
		const raw = await readFile(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		return ConfigSchema.parse(parsed);
	} catch (err) {
		if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
			return DEFAULT_CONFIG;
		}
		if (err instanceof z.ZodError) {
			throw new Error(`Invalid config: ${err.issues.map((i) => i.message).join(", ")}`);
		}
		throw err;
	}
}

export function isWindowAllowed(config: AEyesConfig, windowTitle: string): boolean {
	if (!config.allowlist || config.allowlist.length === 0) {
		return false;
	}
	const lowerTitle = windowTitle.toLowerCase();
	return config.allowlist.some((pattern) => lowerTitle.includes(pattern.toLowerCase()));
}
