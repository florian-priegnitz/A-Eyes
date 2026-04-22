#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runHealthCheck } from "./health-check.js";
import { createServer } from "./server.js";
import { verifyLogs } from "./verify-logs.js";

async function main() {
	if (process.argv.includes("--check")) {
		const { lines, ok } = await runHealthCheck();
		console.log(lines.join("\n"));
		process.exit(ok ? 0 : 1);
	}

	if (process.argv.includes("--verify-logs")) {
		const dateIdx = process.argv.indexOf("--date");
		const dateFilter = dateIdx !== -1 ? process.argv[dateIdx + 1] : undefined;
		const clean = await verifyLogs(dateFilter);
		process.exit(clean ? 0 : 1);
	}

	const server = createServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
