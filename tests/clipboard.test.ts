import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: execFileMock,
}));

describe("clipboard module", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("readClipboard returns text result", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"type":"text","content":"hello world"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { readClipboard } = await import("../src/clipboard.js");
		const result = await readClipboard();

		expect(result).toEqual({ type: "text", content: "hello world" });

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).toContain("-Action");
		expect(args[args.indexOf("-Action") + 1]).toBe("read");
	});

	it("readClipboard returns image result", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"type":"image","data":"ZmFrZQ==","width":800,"height":600}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { readClipboard } = await import("../src/clipboard.js");
		const result = await readClipboard();

		expect(result).toEqual({ type: "image", data: "ZmFrZQ==", width: 800, height: 600 });
	});

	it("readClipboard returns empty result", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"type":"empty"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { readClipboard } = await import("../src/clipboard.js");
		const result = await readClipboard();

		expect(result).toEqual({ type: "empty" });
	});

	it("readClipboard rejects on script error field", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"error":"Clipboard access denied"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { readClipboard } = await import("../src/clipboard.js");
		await expect(readClipboard()).rejects.toThrow("Clipboard access denied");
	});

	it("readClipboard rejects on timeout", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			const err = Object.assign(new Error("timed out"), { killed: true });
			callback(err, "", "");
			return { stdin: { end: vi.fn() } };
		});

		const { readClipboard } = await import("../src/clipboard.js");
		await expect(readClipboard(5000)).rejects.toThrow("Clipboard read timed out after 5000ms");
	});

	it("writeClipboard calls PowerShell with correct args", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"success":true}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { writeClipboard } = await import("../src/clipboard.js");
		await writeClipboard("some text");

		const args = execFileMock.mock.calls[0][1] as string[];
		expect(args).toContain("-Action");
		expect(args[args.indexOf("-Action") + 1]).toBe("write");
		expect(args).toContain("-Text");
		expect(args[args.indexOf("-Text") + 1]).toBe("some text");
	});

	it("writeClipboard rejects on error field", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
			callback(null, '{"error":"Write failed"}', "");
			return { stdin: { end: vi.fn() } };
		});

		const { writeClipboard } = await import("../src/clipboard.js");
		await expect(writeClipboard("text")).rejects.toThrow("Write failed");
	});
});
