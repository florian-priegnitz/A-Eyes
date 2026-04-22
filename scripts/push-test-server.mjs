#!/usr/bin/env node
/**
 * Minimal MCP server to test whether Claude Code consumes push notifications.
 * Sends logging + resource-updated notifications every 5 seconds.
 *
 * Register: claude mcp add push-test -- node /path/to/push-test-server.mjs
 * Remove:   claude mcp remove push-test
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
	name: "push-test",
	version: "0.1.0",
});

// One dummy tool so the server registers
server.tool(
	"push_ping",
	"Returns pong — just a keep-alive tool. After calling, wait 15 seconds and check if you received any notifications from this server.",
	{},
	async () => ({
		content: [
			{
				type: "text",
				text: "pong — notifications will be sent every 5s. Watch for logging messages.",
			},
		],
	}),
);

const transport = new StdioServerTransport();
await server.connect(transport);

// Send notifications every 5 seconds
let tick = 0;
setInterval(async () => {
	tick++;
	const ts = new Date().toISOString();

	// 1) Logging notification (notifications/message)
	try {
		await server.server.sendLoggingMessage({
			level: "warning",
			logger: "push-test",
			data: `[PUSH] Notification #${tick} at ${ts}`,
		});
		process.stderr.write(`[push-test] Sent logging notification #${tick}\n`);
	} catch (e) {
		process.stderr.write(`[push-test] Logging send failed: ${e.message}\n`);
	}

	// 2) Resource updated notification
	try {
		await server.server.sendResourceUpdated({ uri: "push-test://status" });
		process.stderr.write(`[push-test] Sent resource-updated #${tick}\n`);
	} catch (e) {
		process.stderr.write(`[push-test] Resource-updated send failed: ${e.message}\n`);
	}
}, 5000);
