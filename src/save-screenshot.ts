import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

/**
 * Remove characters illegal in filenames, collapse whitespace/underscores,
 * and truncate to a maximum length.
 */
export function sanitizeForFilename(title: string): string {
	let sanitized = title.replace(/[\\/:*?"<>|]/g, "");
	sanitized = sanitized.replace(/[\s_]+/g, "_");
	sanitized = sanitized.replace(/^_+|_+$/g, "");
	sanitized = sanitized.slice(0, 80);
	return sanitized || "screenshot";
}

/**
 * Generate a timestamped filename: {SanitizedTitle}_{YYYYMMDD}_{HHmmss}.png
 */
export function generateFilename(title: string, now = new Date()): string {
	const sanitized = sanitizeForFilename(title);
	const pad = (n: number) => String(n).padStart(2, "0");
	const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
	const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `${sanitized}_${date}_${time}.png`;
}

/**
 * Resolve the output path. If `path` looks like a directory (no .png extension),
 * append a generated filename. Otherwise use as-is.
 */
export function resolveOutputPath(path: string, title: string): string {
	if (extname(path).toLowerCase() === ".png") {
		return path;
	}
	return join(path, generateFilename(title));
}

/**
 * Decode base64 image data and write it to disk, creating directories as needed.
 */
export async function saveScreenshot(base64: string, outputPath: string): Promise<string> {
	const dir = dirname(outputPath);
	await mkdir(dir, { recursive: true });
	const buffer = Buffer.from(base64, "base64");
	await writeFile(outputPath, buffer);
	return outputPath;
}
