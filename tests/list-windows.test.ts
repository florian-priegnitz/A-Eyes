import { describe, expect, it } from "vitest";

describe("list-windows module", () => {
	it("exports listWindows function", async () => {
		const mod = await import("../src/list-windows.js");
		expect(mod.listWindows).toBeDefined();
		expect(typeof mod.listWindows).toBe("function");
	});
});
