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
 * Generate a timestamped filename: {SanitizedTitle}_{YYYYMMDD}_{HHmmss}.{ext}
 */
export function generateFilename(title: string, format?: "png" | "jpeg", now = new Date()): string {
	const sanitized = sanitizeForFilename(title);
	const pad = (n: number) => String(n).padStart(2, "0");
	const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
	const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	const ext = format === "jpeg" ? "jpg" : "png";
	return `${sanitized}_${date}_${time}.${ext}`;
}

/**
 * Resolve the output path. If `path` looks like an image file (.png/.jpg/.jpeg),
 * use as-is. Otherwise treat as directory and append a generated filename.
 */
export function resolveOutputPath(path: string, title: string, format?: "png" | "jpeg"): string {
	const ext = extname(path).toLowerCase();
	if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") {
		return path;
	}
	return join(path, generateFilename(title, format));
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
