function getNonEmptyLines(output: string): string[] {
	return output
		.replace(/\r\n/g, "\n")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

export function parseLastJsonLine(output: string): unknown {
	const lines = getNonEmptyLines(output);
	if (lines.length === 0) {
		throw new Error("No output from PowerShell script");
	}

	const lastLine = lines[lines.length - 1];
	try {
		return JSON.parse(lastLine);
	} catch {
		throw new Error("Failed to parse JSON output from PowerShell script");
	}
}

export function extractBase64Payload(output: string): string | null {
	const compact = output.replace(/\s+/g, "");
	if (!compact) {
		return null;
	}

	const isBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
	if (!isBase64 || compact.length % 4 !== 0) {
		return null;
	}

	return compact;
}
