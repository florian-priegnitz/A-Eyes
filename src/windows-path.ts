/**
 * Convert a WSL path into a Windows path that powershell.exe can resolve.
 * - /mnt/c/... -> C:\...
 * - /home/...  -> \\wsl.localhost\<distro>\home\...
 */
export function toWindowsPath(wslPath: string, distroName = process.env.WSL_DISTRO_NAME): string {
	if (!wslPath) {
		throw new Error("Path must not be empty");
	}

	const normalized = wslPath.replace(/\\/g, "/");

	const driveMatch = normalized.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
	if (driveMatch) {
		const drive = driveMatch[1].toUpperCase();
		const rest = driveMatch[2] ? driveMatch[2].replace(/\//g, "\\") : "";
		return rest ? `${drive}:\\${rest}` : `${drive}:\\`;
	}

	if (normalized.startsWith("/")) {
		if (!distroName) {
			throw new Error(
				"Cannot convert WSL path without WSL_DISTRO_NAME. Set WSL_DISTRO_NAME or place scripts under /mnt/<drive>.",
			);
		}
		return `\\\\wsl.localhost\\${distroName}${normalized.replace(/\//g, "\\")}`;
	}

	return normalized;
}
