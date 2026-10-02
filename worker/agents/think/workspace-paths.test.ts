import { describe, expect, it } from 'vitest';
import type { Tool } from 'ai';
import { normalizeWorkspacePath, withWorkspacePathInput } from './workspace-paths';

/**
 * Same `execute` body as `createWriteTool` in `@cloudflare/think` 0.8.6 (and
 * 0.19.0): the parent is `path.replace(/\/[^/]+$/, '')`, which for a
 * top-level relative path is the path itself. The package cannot be imported
 * in the Workers test pool (its `just-bash` dependency), so it is inlined.
 */
function thinkWriteTool(ops: {
	mkdir: (path: string, opts: { recursive: boolean }) => Promise<void>;
	writeFile: (path: string, content: string) => Promise<void>;
}): Tool {
	return {
		inputSchema: {} as never,
		execute: async ({ path, content }: { path: string; content: string }) => {
			const parent = path.replace(/\/[^/]+$/, '');
			if (parent && parent !== '/') await ops.mkdir(parent, { recursive: true });
			await ops.writeFile(path, content);
			return { path };
		},
	} as unknown as Tool;
}

function recordingOps() {
	const calls: string[] = [];
	return {
		calls,
		ops: {
			mkdir: async (path: string) => {
				calls.push(`mkdir ${path}`);
			},
			writeFile: async (path: string) => {
				calls.push(`writeFile ${path}`);
			},
		},
	};
}

type Exec = (input: unknown, options: unknown) => Promise<unknown>;

describe('withWorkspacePathInput', () => {
	it('reproduces the bug: the raw tool turns a relative wrangler.json into a directory', async () => {
		const { calls, ops } = recordingOps();
		await (thinkWriteTool(ops).execute as Exec)({ path: 'wrangler.json', content: '{}' }, {});
		expect(calls).toEqual(['mkdir wrangler.json', 'writeFile wrangler.json']);
	});

	it('writes a relative top-level path as a file at the workspace root', async () => {
		const { calls, ops } = recordingOps();
		const tool = withWorkspacePathInput(thinkWriteTool(ops));
		const result = await (tool.execute as Exec)({ path: 'wrangler.json', content: '{}' }, {});
		expect(calls).toEqual(['writeFile /wrangler.json']);
		expect(result).toEqual({ path: '/wrangler.json' });
	});

	it('keeps nested parents correct', async () => {
		const { calls, ops } = recordingOps();
		const tool = withWorkspacePathInput(thinkWriteTool(ops));
		await (tool.execute as Exec)({ path: './public//index.html', content: '' }, {});
		expect(calls).toEqual(['mkdir /public', 'writeFile /public/index.html']);
	});

	it('passes inputs without a path through unchanged', async () => {
		let seen: unknown;
		const tool = withWorkspacePathInput({
			execute: async (input: unknown) => {
				seen = input;
				return 'ok';
			},
		} as unknown as Tool);
		await (tool.execute as Exec)({ query: 'x' }, {});
		expect(seen).toEqual({ query: 'x' });
	});
});

describe('normalizeWorkspacePath', () => {
	it.each([
		['wrangler.json', '/wrangler.json'],
		['/wrangler.json', '/wrangler.json'],
		['public/index.html', '/public/index.html'],
		['./src/../public/a.css', '/public/a.css'],
		['', '/'],
		['/', '/'],
	])('%s -> %s', (input, expected) => {
		expect(normalizeWorkspacePath(input)).toBe(expected);
	});
});
