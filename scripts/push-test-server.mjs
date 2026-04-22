#!/usr/bin/env node
/**
 * Minimal MCP server to test whether Claude Code consumes push notifications.
 * Sends logging + resource-updated notifications every 5 seconds.
 *
 * Register: claude mcp add push-test -- node /path/to/push-test-server.mjs
 * Remove:   claude mcp remove push-test
 *
 * Uses the lower-level Server (not McpServer) so capabilities can be declared
 * explicitly — required for sendResourceUpdated to succeed without registering
 * an actual resource (see issue #25 re-validation caveat, 2026-04-22).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
	{ name: "push-test", version: "0.1.0" },
	{
		capabilities: {
			tools: {},
			resources: { listChanged: true },
			logging: {},
		},
	},
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		{
			name: "push_ping",
			description:
				"Returns pong — just a keep-alive tool. After calling, wait 15 seconds and check if you received any notifications from this server.",
			inputSchema: { type: "object", properties: {}, required: [] },
		},
	],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
	if (req.params.name === "push_ping") {
		return {
			content: [
				{
					type: "text",
					text: "pong — notifications will be sent every 5s. Watch for logging messages.",
				},
			],
		};
	}
	return { content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);

// Send notifications every 5 seconds
let tick = 0;
setInterval(async () => {
	tick++;
	const ts = new Date().toISOString();

	// 1) Logging notification (notifications/message)
	try {
		await server.sendLoggingMessage({
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
		await server.sendResourceUpdated({ uri: "push-test://status" });
		process.stderr.write(`[push-test] Sent resource-updated #${tick}\n`);
	} catch (e) {
		process.stderr.write(`[push-test] Resource-updated send failed: ${e.message}\n`);
	}
}, 5000);
