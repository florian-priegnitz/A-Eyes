import { createHmac, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const GENESIS_HASH = "0".repeat(64);

let cachedKey: Buffer | null = null;

function getKeyFilePath(): string {
	return join(homedir(), ".a-eyes", "audit.key");
}

export async function getAuditKey(): Promise<Buffer> {
	if (cachedKey) {
		return cachedKey;
	}

	// 1. Check env var
	const envKey = process.env.A_EYES_AUDIT_KEY;
	if (envKey) {
		cachedKey = Buffer.from(envKey, "hex");
		return cachedKey;
	}

	// 2. Try reading keyfile
	try {
		const keyHex = await readFile(getKeyFilePath(), "utf-8");
		cachedKey = Buffer.from(keyHex.trim(), "hex");
		return cachedKey;
	} catch (err) {
		if (
			!(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT")
		) {
			throw err;
		}
	}

	// 3. Auto-generate
	const key = randomBytes(32);
	const dir = join(homedir(), ".a-eyes");
	await mkdir(dir, { recursive: true });
	await writeFile(getKeyFilePath(), key.toString("hex"), { mode: 0o600 });
	await chmod(getKeyFilePath(), 0o600);
	cachedKey = key;
	return cachedKey;
}

export function computeHmac(key: Buffer, data: string): string {
	return createHmac("sha256", key).update(data).digest("hex");
}

export interface SignedFields {
	sig: string;
	prev_hash: string;
}

export function signEntry(key: Buffer, entryJson: string, prevHash: string): SignedFields {
	const payload = `${entryJson}|${prevHash}`;
	const sig = computeHmac(key, payload);
	return { sig, prev_hash: prevHash };
}

/** Reset cached key (for testing) */
export function _resetKeyCache(): void {
	cachedKey = null;
}
