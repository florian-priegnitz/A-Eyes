import { createHash } from "node:crypto";
import { type CaptureResult, captureWindow } from "./capture.js";

export interface WatchOptions {
	windowTitle?: string;
	processName?: string;
	mode?: "window" | "screen";
	pollIntervalMs: number;
	timeoutMs: number;
	signal?: AbortSignal;
	/** Called before each capture. Throw to abort the watch (e.g. rate limit exhausted). */
	preCaptureHook?: () => void | Promise<void>;
	/** Called after each capture with the actual window metadata. Throw to abort the watch (e.g. allowlist violation). */
	postCaptureCheck?: (windowTitle: string, processName: string | undefined) => void | Promise<void>;
}

export interface WatchResult {
	base64: string;
	windowTitle: string;
	processName?: string;
	changed: boolean;
	elapsedMs: number;
	polls: number;
}

function hashImage(base64: string): string {
	return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
}

export async function watchWindow(options: WatchOptions): Promise<WatchResult> {
	const start = Date.now();
	let baselineHash: string | undefined;
	let lastResult: CaptureResult | undefined;
	let polls = 0;

	while (Date.now() - start < options.timeoutMs) {
		if (options.signal?.aborted) throw new Error("Watch aborted");

		if (options.preCaptureHook) {
			await options.preCaptureHook();
		}

		const result = await captureWindow(
			options.windowTitle,
			undefined, // timeoutMs (capture default)
			undefined, // maxWidth
			undefined, // crop
			options.processName,
			undefined, // format (default png for stable hash)
			undefined, // quality
			options.mode ?? "window",
		);
		polls++;

		if (options.postCaptureCheck) {
			await options.postCaptureCheck(result.windowTitle, result.processName);
		}

		const hash = hashImage(result.base64);

		if (baselineHash === undefined) {
			baselineHash = hash;
			lastResult = result;
		} else if (hash !== baselineHash) {
			return {
				base64: result.base64,
				windowTitle: result.windowTitle,
				processName: result.processName,
				changed: true,
				elapsedMs: Date.now() - start,
				polls,
			};
		} else {
			lastResult = result;
		}

		const remaining = options.timeoutMs - (Date.now() - start);
		if (remaining <= 0) break;
		await new Promise((r) => setTimeout(r, Math.min(options.pollIntervalMs, remaining)));
	}

	// Timeout path — return last capture with changed=false
	if (!lastResult) {
		throw new Error("Watch completed without any capture");
	}
	return {
		base64: lastResult.base64,
		windowTitle: lastResult.windowTitle,
		processName: lastResult.processName,
		changed: false,
		elapsedMs: Date.now() - start,
		polls,
	};
}
