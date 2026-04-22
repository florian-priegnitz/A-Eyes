#!/usr/bin/env node
/**
 * Minimal Channel server to test whether Claude Code consumes channel notifications.
 * Uses the `claude/channel` experimental capability.
 *
 * Register & run:
 *   claude mcp add channel-test -- node /path/to/channel-test-server.mjs
 *   claude --dangerously-load-development-channels server:channel-test
 *
 * Remove:
 *   claude mcp remove channel-test
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
	{ name: "channel-test", version: "0.1.0" },
	{
		capabilities: {
			tools: {},
			experimental: { "claude/channel": {} },
		},
		instructions:
			'This is a test channel. Messages arrive as <channel source="channel-test">. Acknowledge each one briefly.',
	},
);

// Tool: trigger a push notification manually
server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		{
			name: "channel_ping",
			description:
				"Triggers a channel notification. Call this, then check if you receive a <channel> message within 10 seconds.",
			inputSchema: { type: "object", properties: {}, required: [] },
		},
	],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
	if (req.params.name === "channel_ping") {
		// Send channel notification after a short delay
		setTimeout(async () => {
			try {
				await server.notification({
					method: "notifications/claude/channel",
					params: {
						content: `[channel-test] Push notification at ${new Date().toISOString()} — if you see this, channels work!`,
						meta: { test: true, tick: 1 },
					},
				});
				process.stderr.write("[channel-test] Sent channel notification\n");
			} catch (e) {
				process.stderr.write(`[channel-test] Channel send failed: ${e.message}\n`);
			}
		}, 2000);

		return {
			content: [
				{
					type: "text",
					text: 'Pong! A channel notification will be sent in 2 seconds. Watch for a <channel source="channel-test"> message.',
				},
			],
		};
	}
	return { content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);

// Also send periodic notifications every 10s
let tick = 0;
setInterval(async () => {
	tick++;
	try {
		await server.notification({
			method: "notifications/claude/channel",
			params: {
				content: `[channel-test] Periodic notification #${tick} at ${new Date().toISOString()}`,
				meta: { test: true, tick },
			},
		});
		process.stderr.write(`[channel-test] Sent periodic notification #${tick}\n`);
	} catch (e) {
		process.stderr.write(`[channel-test] Periodic send failed: ${e.message}\n`);
	}
}, 10000);

process.stderr.write("[channel-test] Channel server started. Sending notifications every 10s.\n");
