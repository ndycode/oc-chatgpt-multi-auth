/**
 * Path resolution utilities for account storage.
 * Extracted from storage.ts to reduce module size.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

const PROJECT_MARKERS = [".git", "package.json", "Cargo.toml", "go.mod", "pyproject.toml", ".opencode"];

export function getConfigDir(): string {
	return join(homedir(), ".opencode");
}

export function getProjectConfigDir(projectPath: string): string {
	return join(projectPath, ".opencode");
}

export function isProjectDirectory(dir: string): boolean {
	return PROJECT_MARKERS.some((marker) => existsSync(join(dir, marker)));
}

export function findProjectRoot(startDir: string): string | null {
	let current = startDir;
	const root = dirname(current) === current ? current : null;
	
	while (current) {
		if (isProjectDirectory(current)) {
			return current;
		}
		
		const parent = dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}
	
	return root && isProjectDirectory(root) ? root : null;
}

export function resolvePath(filePath: string): string {
	let resolved: string;
	if (filePath.startsWith("~")) {
		resolved = join(homedir(), filePath.slice(1));
	} else {
		resolved = resolve(filePath);
	}

	const home = homedir();
	const cwd = process.cwd();
	const tmp = tmpdir();
	if (!resolved.startsWith(home) && !resolved.startsWith(cwd) && !resolved.startsWith(tmp)) {
		throw new Error(`Access denied: path must be within home directory, project directory, or temp directory`);
	}

	return resolved;
}
