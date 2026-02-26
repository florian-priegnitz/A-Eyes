import { describe, expect, it } from "vitest";

// We test the pure utility functions that don't require PowerShell.
// The actual captureWindow function requires a Windows environment.

// Import the module to verify it loads correctly
describe("capture module", () => {
	it("exports captureWindow function", async () => {
		const mod = await import("../src/capture.js");
		expect(mod.captureWindow).toBeDefined();
		expect(typeof mod.captureWindow).toBe("function");
	});
});
