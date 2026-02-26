import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

describe("createServer", () => {
	it("creates an MCP server instance", () => {
		const server = createServer();
		expect(server).toBeDefined();
	});

	it("server has expected properties", () => {
		const server = createServer();
		// McpServer exposes tool registration via the tool() method
		expect(typeof server.tool).toBe("function");
		expect(typeof server.connect).toBe("function");
	});
});
