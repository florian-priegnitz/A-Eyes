import type { AEyesConfig, RedactionRegion } from "./config.js";

export function findMatchingRules(
	config: AEyesConfig,
	windowTitle?: string,
	processName?: string,
): RedactionRegion[] {
	if (!config.redaction_rules || config.redaction_rules.length === 0) {
		return [];
	}

	const candidates = [windowTitle, processName].filter(
		(s): s is string => s !== undefined && s !== "",
	);

	if (candidates.length === 0) {
		return [];
	}

	const regions: RedactionRegion[] = [];

	for (const rule of config.redaction_rules) {
		let regex: RegExp;
		try {
			regex = new RegExp(rule.match, "i");
		} catch {
			continue;
		}
		if (candidates.some((c) => regex.test(c))) {
			regions.push(...rule.regions);
		}
	}

	return regions;
}

export interface RedactionResult {
	base64: string;
	redactedCount: number;
}

export async function applyRedactions(
	base64Png: string,
	regions: RedactionRegion[],
): Promise<RedactionResult> {
	if (regions.length === 0) {
		return { base64: base64Png, redactedCount: 0 };
	}

	const sharp = (await import("sharp")).default;
	const inputBuffer = Buffer.from(base64Png, "base64");
	let image = sharp(inputBuffer);
	const metadata = await image.metadata();
	const imgWidth = metadata.width ?? 0;
	const imgHeight = metadata.height ?? 0;

	const composites: { input: Buffer; left: number; top: number }[] = [];
	let redactedCount = 0;

	for (const region of regions) {
		// Skip regions entirely outside image bounds
		if (region.x >= imgWidth || region.y >= imgHeight) {
			continue;
		}

		// Clamp region to image bounds
		const left = Math.max(0, region.x);
		const top = Math.max(0, region.y);
		const width = Math.min(region.width, imgWidth - left);
		const height = Math.min(region.height, imgHeight - top);

		if (width <= 0 || height <= 0) {
			continue;
		}

		let overlay: Buffer;

		if (region.method === "blackout") {
			overlay = await sharp({
				create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
			})
				.png()
				.toBuffer();
		} else if (region.method === "blur") {
			overlay = await sharp(inputBuffer).extract({ left, top, width, height }).blur(20).toBuffer();
		} else {
			// pixelate: scale down then up
			const pixelSize = Math.max(1, Math.floor(Math.min(width, height) / 8));
			overlay = await sharp(inputBuffer)
				.extract({ left, top, width, height })
				.resize(pixelSize, pixelSize, { kernel: "nearest" })
				.resize(width, height, { kernel: "nearest" })
				.toBuffer();
		}

		composites.push({ input: overlay, left, top });
		redactedCount++;
	}

	if (composites.length === 0) {
		return { base64: base64Png, redactedCount: 0 };
	}

	image = sharp(inputBuffer).composite(composites);
	const outputBuffer = await image.png().toBuffer();
	return { base64: outputBuffer.toString("base64"), redactedCount };
}
