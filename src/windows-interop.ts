export function formatPowerShellExecutionError(stderr: string, fallbackMessage: string): string {
	const details = (stderr || fallbackMessage).trim();
	const normalized = details.toLowerCase();

	const isInteropDisabled =
		normalized.includes("exec format error") ||
		normalized.includes("cannot execute binary file") ||
		normalized.includes(" mz");

	if (!isInteropDisabled) {
		return details;
	}

	return [
		"Windows interop is not available in this WSL session (cannot execute powershell.exe).",
		"Run `wsl --shutdown` from Windows PowerShell/CMD and restart your distro.",
		`Original error: ${details}`,
	].join(" ");
}
