import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AuditEntry {
	timestamp: string;
	tool: "capture" | "query" | "list_windows" | "check_status" | "setup" | "see";
	params: Record<string, unknown>;
	result: "success" | "blocked" | "error" | "rate_limited";
	duration_ms: number;
	windows_count?: number;
	error?: string;
}

/**
 * Returns the audit log file path for a given date.
 * Format: ~/.a-eyes/logs/audit-YYYY-MM-DD.jsonl
 */
export function getAuditLogPath(now = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	const date = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
	return join(homedir(), ".a-eyes", "logs", `audit-${date}.jsonl`);
}

/**
 * Append an audit entry as a JSONL line to the daily log file.
 * Creates the directory if it doesn't exist.
 */
export async function writeAuditEntry(entry: AuditEntry): Promise<void> {
	const logPath = getAuditLogPath(new Date(entry.timestamp));
	const dir = join(homedir(), ".a-eyes", "logs");
	await mkdir(dir, { recursive: true });
	await appendFile(logPath, `${JSON.stringify(entry)}\n`);
}
