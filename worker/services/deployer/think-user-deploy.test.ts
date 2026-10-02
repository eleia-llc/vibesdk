import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BranchDeploymentBundle } from '@space-do/space';
import { sanitizeWorkerName } from './think-user-deploy';

const deployWithAssets = vi.fn();
const deploySimple = vi.fn();
const enableWorkersDev = vi.fn();
const getWorkersDevSubdomain = vi.fn();

vi.mock('./deployer', () => ({
	WorkerDeployer: vi.fn().mockImplementation(() => ({
		deployWithAssets,
		deploySimple,
	})),
}));

vi.mock('./api/cloudflare-api', () => ({
	CloudflareAPI: vi.fn().mockImplementation(() => ({
		enableWorkersDev,
		getWorkersDevSubdomain,
	})),
}));

// Import after mocks are registered
const { buildEntryModule, deployThinkBundleToUserAccount, deployThinkBundleToPlatform } = await import('./think-user-deploy');

function makeBundle(overrides?: Partial<BranchDeploymentBundle>): BranchDeploymentBundle {
	return {
		modules: {
			'index.js': 'export class App {}\nexport default { fetch() { return new Response("ok"); } };',
		},
		mainModule: 'index.js',
		assets: { '/index.html': '<html><body>hi</body></html>' },
		assetConfig: {},
		compatibilityDate: '2025-01-01',
		commitHash: 'abcdef1234567890abcdef',
		...overrides,
	} as unknown as BranchDeploymentBundle;
}

describe('sanitizeWorkerName', () => {
	it('creates a stable Workers-compatible script name', () => {
		expect(sanitizeWorkerName(' Vibe: My New App! ')).toBe('vibe-my-new-app');
	});

	it('limits names and provides a fallback', () => {
		expect(sanitizeWorkerName('!@#$')).toBe('vibe-app');
		expect(sanitizeWorkerName('A'.repeat(100))).toHaveLength(63);
	});
});

describe('deployThinkBundleToPlatform', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('deploys into the dispatch namespace and returns a preview-domain URL', async () => {
		const result = await deployThinkBundleToPlatform({
			accountId: 'platform-account',
			apiToken: 'platform-token',
			dispatchNamespace: 'vibesdk-default-namespace',
			previewDomain: 'build-preview.cloudflare.dev',
			appName: 'My App',
			bundle: makeBundle(),
		});

		expect(result.deploymentId).toBe('my-app');
		expect(result.deploymentUrl).toBe('https://my-app.build-preview.cloudflare.dev');
		expect(deployWithAssets).toHaveBeenCalledTimes(1);
		// dispatchNamespace is the 8th positional arg of deployWithAssets
		expect(deployWithAssets.mock.calls[0][7]).toBe('vibesdk-default-namespace');
		// Platform deploys never touch workers.dev
		expect(enableWorkersDev).not.toHaveBeenCalled();
		expect(getWorkersDevSubdomain).not.toHaveBeenCalled();
	});

	it('falls back to a simple deploy when the bundle has no assets', async () => {
		await deployThinkBundleToPlatform({
			accountId: 'platform-account',
			apiToken: 'platform-token',
			dispatchNamespace: 'vibesdk-default-namespace',
			previewDomain: 'build-preview.cloudflare.dev',
			appName: 'My App',
			bundle: makeBundle({ assets: {} }),
		});

		expect(deploySimple).toHaveBeenCalledTimes(1);
		// dispatchNamespace is the 6th positional arg of deploySimple
		expect(deploySimple.mock.calls[0][5]).toBe('vibesdk-default-namespace');
		expect(deployWithAssets).not.toHaveBeenCalled();
	});
});

describe('deployThinkBundleToPlatform: assets-only static site', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('publishes an assets-only bundle with a generated asset-serving entry and no App', async () => {
		const result = await deployThinkBundleToPlatform({
			accountId: 'platform-account',
			apiToken: 'platform-token',
			dispatchNamespace: 'vibesdk-default-namespace',
			previewDomain: 'build-preview.cloudflare.dev',
			appName: 'Arepas La Mona',
			bundle: makeBundle({
				mainModule: '',
				modules: {},
				assets: { '/index.html': '<h1>Arepas</h1>', '/styles.css': 'h1{}' },
				assetConfig: { not_found_handling: 'single-page-application' },
			}),
		});

		expect(result.deploymentId).toBe('arepas-la-mona');
		expect(deployWithAssets).toHaveBeenCalledTimes(1);
		const [, entry, , manifest, , bindings, , namespace, assetsConfig, modules, , migrations] =
			deployWithAssets.mock.calls[0];
		expect(Object.keys(manifest).sort()).toEqual(['/index.html', '/styles.css']);
		expect(entry).toContain('env.ASSETS.fetch(request)');
		expect(entry).not.toMatch(/from "\.\//);
		expect(bindings).toEqual([{ name: 'ASSETS', type: 'assets' }]);
		expect(namespace).toBe('vibesdk-default-namespace');
		expect(assetsConfig).toMatchObject({ binding: 'ASSETS', not_found_handling: 'single-page-application' });
		expect([...modules.keys()]).toEqual([]);
		expect(migrations).toBeUndefined();
	});
});

describe('buildEntryModule', () => {
	it('serves a 404-page static site straight from ASSETS (real 404.html, no SPA fallback)', () => {
		const entry = buildEntryModule('', true, false, '404-page');
		expect(entry).toContain('return env.ASSETS.fetch(request);');
		// The SPA fallback answered unknown HTML paths with /index.html, which the
		// asset platform redirects (307) to "/": a soft 404 for crawlers.
		expect(entry).not.toContain('/index.html');
		expect(entry).not.toContain('"Not Found"');
	});

	it('keeps the SPA fallback for static sites without 404-page handling', () => {
		for (const handling of [undefined, 'single-page-application', 'none']) {
			const entry = buildEntryModule('', true, false, handling);
			expect(entry).toContain('new URL("/index.html", request.url)');
		}
	});

	it('still routes to the App when a server Worker declares 404-page', () => {
		const entry = buildEntryModule('index.js', true, true, '404-page');
		expect(entry).toContain('export { App } from "./index.js"');
		expect(entry).toContain('env.VIBE_APP.get(');
	});
});

describe('deployThinkBundleToPlatform: static site with 404-page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('publishes an entry that returns ASSETS responses verbatim', async () => {
		await deployThinkBundleToPlatform({
			accountId: 'platform-account',
			apiToken: 'platform-token',
			dispatchNamespace: 'vibesdk-default-namespace',
			previewDomain: 'build-preview.cloudflare.dev',
			appName: 'Tostadora Lomaverde',
			bundle: makeBundle({
				mainModule: '',
				modules: {},
				assets: { '/index.html': '<h1>Lomaverde</h1>', '/404.html': '<h1>No encontrada</h1>' },
				assetConfig: { html_handling: 'auto-trailing-slash', not_found_handling: '404-page' },
			}),
		});
		const [, entry, , , , , , , assetsConfig] = deployWithAssets.mock.calls[0];
		expect(entry).toContain('return env.ASSETS.fetch(request);');
		expect(entry).not.toContain('/index.html');
		expect(assetsConfig).toMatchObject({ binding: 'ASSETS', not_found_handling: '404-page' });
	});
});

describe('deployThinkBundleToUserAccount', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getWorkersDevSubdomain.mockResolvedValue('user-sub');
	});

	it('deploys without a dispatch namespace and enables workers.dev', async () => {
		const result = await deployThinkBundleToUserAccount({
			accountId: 'user-account',
			accessToken: 'user-token',
			appName: 'My App',
			bundle: makeBundle(),
		});

		expect(deployWithAssets).toHaveBeenCalledTimes(1);
		expect(deployWithAssets.mock.calls[0][7]).toBeUndefined();
		expect(enableWorkersDev).toHaveBeenCalledWith('my-app');
		expect(result.deploymentUrl).toBe('https://my-app.user-sub.workers.dev');
	});
});
