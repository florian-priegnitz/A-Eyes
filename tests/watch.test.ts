import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchWindow } from "../src/watch.js";

const { captureWindowMock } = vi.hoisted(() => ({
	captureWindowMock: vi.fn(),
}));

vi.mock("../src/capture.js", () => ({
	captureWindow: captureWindowMock,
}));

function makeCapture(base64: string, windowTitle = "TestWindow") {
	return { base64, windowTitle, processName: "test.exe" };
}

describe("watchWindow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// Use real timers — poll intervals are set to 1ms so tests run fast.

	it("returns changed=true when content changes on poll 3", async () => {
		const stable = "aW1hZ2Vz"; // base64 "images"
		const changed = "Y2hhbmdlZA=="; // base64 "changed"

		captureWindowMock
			.mockResolvedValueOnce(makeCapture(stable)) // poll 1 — baseline
			.mockResolvedValueOnce(makeCapture(stable)) // poll 2 — same
			.mockResolvedValueOnce(makeCapture(changed)); // poll 3 — changed

		const result = await watchWindow({
			windowTitle: "TestWindow",
			pollIntervalMs: 1,
			timeoutMs: 5000,
		});

		expect(result.changed).toBe(true);
		expect(result.polls).toBe(3);
		expect(result.base64).toBe(changed);
	});

	it("returns changed=false when content never changes (timeout)", async () => {
		const stable = "aW1hZ2Vz";
		captureWindowMock.mockResolvedValue(makeCapture(stable));

		const result = await watchWindow({
			windowTitle: "TestWindow",
			pollIntervalMs: 1,
			timeoutMs: 20, // Very short timeout
		});

		expect(result.changed).toBe(false);
		expect(result.polls).toBeGreaterThanOrEqual(1);
		expect(result.base64).toBe(stable);
	});

	it("propagates captureWindow errors", async () => {
		captureWindowMock.mockRejectedValue(new Error("capture failed"));

		await expect(
			watchWindow({
				windowTitle: "TestWindow",
				pollIntervalMs: 1,
				timeoutMs: 5000,
			}),
		).rejects.toThrow("capture failed");
	});

	it("aborts when signal is aborted after first poll", async () => {
		const stable = "aW1hZ2Vz";
		let callCount = 0;
		captureWindowMock.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				// Abort after baseline is captured
				controller.abort();
			}
			return makeCapture(stable);
		});

		const controller = new AbortController();

		await expect(
			watchWindow({
				windowTitle: "TestWindow",
				pollIntervalMs: 1,
				timeoutMs: 5000,
				signal: controller.signal,
			}),
		).rejects.toThrow("Watch aborted");
	});

	it("propagates preCaptureHook error", async () => {
		captureWindowMock.mockResolvedValue(makeCapture("aW1hZ2Vz"));

		await expect(
			watchWindow({
				windowTitle: "TestWindow",
				pollIntervalMs: 1,
				timeoutMs: 5000,
				preCaptureHook: () => {
					throw new Error("Rate limit exhausted mid-watch");
				},
			}),
		).rejects.toThrow("Rate limit exhausted mid-watch");
	});

	it("propagates postCaptureCheck error on poll 2 and does not return poll 1 as success", async () => {
		const stable = "aW1hZ2Vz";
		const changed = "Y2hhbmdlZA==";
		captureWindowMock
			.mockResolvedValueOnce(makeCapture(stable, "AllowedWindow"))
			.mockResolvedValueOnce(makeCapture(changed, "MaliciousWindow"));

		let pollCount = 0;
		const postCaptureCheck = (title: string) => {
			pollCount++;
			if (pollCount >= 2) {
				throw new Error(`Allowlist check failed mid-watch: window '${title}'`);
			}
		};

		await expect(
			watchWindow({
				windowTitle: "AllowedWindow",
				pollIntervalMs: 1,
				timeoutMs: 5000,
				postCaptureCheck,
			}),
		).rejects.toThrow("Allowlist check failed mid-watch");
	});

	it("passes processName and mode to captureWindow", async () => {
		const stable = "aW1hZ2Vz";
		captureWindowMock.mockResolvedValue(makeCapture(stable));

		await watchWindow({
			processName: "myapp",
			mode: "window",
			pollIntervalMs: 1,
			timeoutMs: 10,
		});

		expect(captureWindowMock).toHaveBeenCalledWith(
			undefined, // windowTitle
			undefined, // timeoutMs
			undefined, // maxWidth
			undefined, // crop
			"myapp", // processName
			undefined, // format
			undefined, // quality
			"window", // mode
		);
	});
});
