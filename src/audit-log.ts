import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { GENESIS_HASH, getAuditKey, signEntry } from "./audit-signing.js";

export interface AuditEntry {
	timestamp: string;
	tool:
		| "capture"
		| "query"
		| "list_windows"
		| "check_status"
		| "setup"
		| "see"
		| "clipboard"
		| "processes"
		| "event_log";
	params: Record<string, unknown>;
	result: "success" | "blocked" | "error" | "rate_limited" | "denied";
	duration_ms: number;
	windows_count?: number;
	error?: string;
}

export interface SignedAuditEntry extends AuditEntry {
	sig: string;
	prev_hash: string;
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

// Cache the last sig to avoid re-reading the file on every write
let lastSig: string | null = null;
let lastLogPath: string | null = null;

async function getLastSig(logPath: string): Promise<string> {
	if (lastSig && lastLogPath === logPath) {
		return lastSig;
	}

	try {
		const content = await readFile(logPath, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);
		if (lines.length > 0) {
			const lastLine = JSON.parse(lines[lines.length - 1]);
			if (lastLine.sig) {
				return lastLine.sig;
			}
		}
	} catch {
		// File doesn't exist yet or is empty
	}

	return GENESIS_HASH;
}

/**
 * Append a signed audit entry as a JSONL line to the daily log file.
 * Creates the directory if it doesn't exist.
 * Each entry is HMAC-SHA256 signed with a hash chain.
 */
export async function writeAuditEntry(entry: AuditEntry): Promise<void> {
	const logPath = getAuditLogPath(new Date(entry.timestamp));
	const dir = join(homedir(), ".a-eyes", "logs");
	await mkdir(dir, { recursive: true });

	const key = await getAuditKey();
	const prevHash = await getLastSig(logPath);
	const entryJson = JSON.stringify(entry);
	const { sig, prev_hash } = signEntry(key, entryJson, prevHash);

	const signedEntry: SignedAuditEntry = { ...entry, sig, prev_hash };
	await appendFile(logPath, `${JSON.stringify(signedEntry)}\n`);

	// Update cache
	lastSig = sig;
	lastLogPath = logPath;
}

/** Reset cache (for testing) */
export function _resetAuditCache(): void {
	lastSig = null;
	lastLogPath = null;
}
