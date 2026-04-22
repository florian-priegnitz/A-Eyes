import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { GENESIS_HASH, getAuditKey, signEntry } from "./audit-signing.js";

export interface VerifyResult {
	file: string;
	valid: number;
	unsigned: number;
	tampered: number;
	errors: string[];
}

export async function verifyLogFile(filePath: string, key: Buffer): Promise<VerifyResult> {
	const result: VerifyResult = {
		file: filePath,
		valid: 0,
		unsigned: 0,
		tampered: 0,
		errors: [],
	};

	const content = await readFile(filePath, "utf-8");
	const lines = content.trim().split("\n").filter(Boolean);

	let prevSig = GENESIS_HASH;

	for (let i = 0; i < lines.length; i++) {
		const lineNum = i + 1;
		let parsed: Record<string, unknown>;
		try {
			parsed = JSON.parse(lines[i]);
		} catch {
			result.tampered++;
			result.errors.push(`Line ${lineNum}: invalid JSON`);
			continue;
		}

		if (!parsed.sig || !parsed.prev_hash) {
			result.unsigned++;
			prevSig = GENESIS_HASH; // Reset chain for unsigned entries
			continue;
		}

		const storedSig = parsed.sig as string;
		const storedPrevHash = parsed.prev_hash as string;

		// Verify chain link
		if (storedPrevHash !== prevSig) {
			result.tampered++;
			result.errors.push(`Line ${lineNum}: chain broken (prev_hash mismatch)`);
			prevSig = storedSig;
			continue;
		}

		// Recompute HMAC from entry content (without sig and prev_hash)
		const { sig: _sig, prev_hash: _prevHash, ...entryWithoutSigning } = parsed;
		const entryJson = JSON.stringify(entryWithoutSigning);
		const { sig: expectedSig } = signEntry(key, entryJson, storedPrevHash);

		if (storedSig !== expectedSig) {
			result.tampered++;
			result.errors.push(`Line ${lineNum}: HMAC mismatch (content tampered)`);
		} else {
			result.valid++;
		}

		prevSig = storedSig;
	}

	return result;
}

export async function verifyLogs(dateFilter?: string): Promise<boolean> {
	const logsDir = join(homedir(), ".a-eyes", "logs");
	const key = await getAuditKey();

	let files: string[];
	try {
		const allFiles = await readdir(logsDir);
		files = allFiles.filter((f) => f.startsWith("audit-") && f.endsWith(".jsonl")).sort();
	} catch {
		console.log("No audit logs found.");
		return true;
	}

	if (dateFilter) {
		files = files.filter((f) => f.includes(dateFilter));
	}

	if (files.length === 0) {
		console.log(
			dateFilter ? `No audit logs found for date ${dateFilter}.` : "No audit logs found.",
		);
		return true;
	}

	let allClean = true;

	for (const file of files) {
		const filePath = join(logsDir, file);
		const result = await verifyLogFile(filePath, key);

		const status = result.tampered > 0 ? "TAMPERED" : "CLEAN";
		console.log(
			`${file}: ${status} (${result.valid} valid, ${result.unsigned} unsigned, ${result.tampered} tampered)`,
		);

		for (const error of result.errors) {
			console.log(`  ${error}`);
		}

		if (result.tampered > 0) {
			allClean = false;
		}
	}

	return allClean;
}
