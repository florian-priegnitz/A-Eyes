import { describe, expect, it } from "vitest";
import { toWindowsPath } from "../src/windows-path.js";

describe("toWindowsPath", () => {
	it("converts /mnt drive paths", () => {
		expect(toWindowsPath("/mnt/c/Users/test/file.ps1")).toBe("C:\\Users\\test\\file.ps1");
	});

	it("converts non-/mnt WSL paths to \\wsl.localhost", () => {
		expect(toWindowsPath("/home/user/project/scripts/screenshot.ps1", "Ubuntu")).toBe(
			"\\\\wsl.localhost\\Ubuntu\\home\\user\\project\\scripts\\screenshot.ps1",
		);
	});

	it("throws for non-/mnt path without distro", () => {
		expect(() => toWindowsPath("/home/user/project/scripts/screenshot.ps1", "")).toThrow(
			"WSL_DISTRO_NAME",
		);
	});
});
