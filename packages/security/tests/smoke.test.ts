import { describe, expect, it } from "vitest";

describe("@a-eyes/security workspace resolution", () => {
	it("resolves the package via workspace import", async () => {
		const mod = await import("@a-eyes/security");
		expect(mod).toBeDefined();
		expect(typeof mod).toBe("object");
	});
});
