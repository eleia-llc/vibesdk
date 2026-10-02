/**
 * Workspace path normalization for the SpaceDO-backed Think file tools.
 *
 * The models often pass relative paths (`wrangler.json`, `src/index.ts`) even
 * though the tools ask for absolute ones. `@cloudflare/think`'s `write` tool
 * (checked up to 0.19.0) derives the parent directory with
 * `path.replace(/\/[^/]+$/, "")`. For a top-level relative path there is no
 * slash, so the "parent" is the path itself: writing `wrangler.json` first
 * runs `mkdir("wrangler.json", { recursive: true })` and then writes into that
 * directory. The SQL workspace keeps the entry as a directory, so the tool
 * reports success while `wrangler.json` is an empty directory. The deploy
 * then reads no wrangler config, ships no assets, and the preview 404s.
 *
 * Normalizing every `path` argument to an absolute workspace path before the
 * tool runs gives the tool a parent it computes correctly (`/`).
 */
import type { Tool } from 'ai';

/** `wrangler.json` → `/wrangler.json`; resolves `.`/`..` and duplicate slashes. */
export function normalizeWorkspacePath(path: string): string {
	const parts: string[] = [];
	for (const part of path.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') parts.pop();
		else parts.push(part);
	}
	return `/${parts.join('/')}`;
}

type ExecutableTool = Tool & {
	execute?: (input: unknown, options: unknown) => unknown;
};

/**
 * Wrap a workspace tool so its `path` input is normalized before `execute`.
 * Tools without a string `path` input are returned unchanged in behavior.
 */
export function withWorkspacePathInput<T extends Tool>(tool: T): T {
	const base = tool as ExecutableTool;
	const execute = base.execute;
	if (!execute) return tool;
	return {
		...base,
		execute: (input: unknown, options: unknown) => {
			if (input && typeof input === 'object' && typeof (input as { path?: unknown }).path === 'string') {
				const path = (input as { path: string }).path;
				return execute.call(base, { ...input, path: normalizeWorkspacePath(path) }, options);
			}
			return execute.call(base, input, options);
		},
	} as unknown as T;
}
