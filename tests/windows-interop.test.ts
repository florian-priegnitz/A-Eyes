import { describe, expect, it } from "vitest";
import { formatPowerShellExecutionError } from "../src/windows-interop.js";

describe("formatPowerShellExecutionError", () => {
	it("keeps normal stderr output unchanged", () => {
		const out = formatPowerShellExecutionError("Window not found", "fallback");
		expect(out).toBe("Window not found");
	});

	it("maps exec format errors to actionable interop guidance", () => {
		const out = formatPowerShellExecutionError(
			"/mnt/c/.../powershell.exe: cannot execute binary file: Exec format error",
			"spawn failed",
		);
		expect(out).toContain("Windows interop is not available");
		expect(out).toContain("wsl --shutdown");
	});
});
