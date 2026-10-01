import { describe, expect, it } from 'vitest';
import { deployDevBrowserConsoleWarning, localPreviewCaptureBlock, previewCaptureWarning } from './preview-capture-warning';

describe('preview capture warnings', () => {
	it('blocks loopback previews before Browser Run launches', () => {
		const warning = localPreviewCaptureBlock(
			'http://localhost:5173/space/app/preview/main/?t=token',
		);
		expect(warning).toContain('DEV_BROWSER_PREVIEW_ORIGIN');
		expect(warning).toContain('ENVIRONMENT=prod');
		expect(localPreviewCaptureBlock('https://vibesdk-eval.eleia.workers.dev/space/app/preview/main/')).toBeUndefined();
	});

	it('explains a 403 on workers.dev and stays quiet for other hosts without a 403', () => {
		const workersDev = previewCaptureWarning('https://vibesdk-eval.eleia.workers.dev/space/app/preview/main/?t=1', [
			{
				url: 'https://vibesdk-eval.eleia.workers.dev/space/app/preview/main/?t=1',
				failure: 'HTTP 403',
				status: 403,
			},
		]);
		expect(workersDev).toContain('workers.dev');
		expect(workersDev).toContain('CUSTOM_DOMAIN');
		expect(workersDev).toContain('Cloudflare Access');

		const unrelated = previewCaptureWarning('https://app.example.com/space/app/preview/main/', [
			{ url: 'https://cdn.example/asset.js', failure: 'HTTP 403', status: 403 },
		]);
		expect(unrelated).toBeUndefined();
	});

	it('warns about the console only when a dev browser var is set', () => {
		expect(deployDevBrowserConsoleWarning({}, undefined)).toBeUndefined();
		expect(deployDevBrowserConsoleWarning({ DEV_BROWSER_PREVIEW_ORIGIN: '   ' })).toBeUndefined();
		const warning = deployDevBrowserConsoleWarning(
			{ DEV_BROWSER_PREVIEW_ORIGIN: 'http://localhost:5173' },
			{ DEV_BROWSER_SIDECAR_URL: '' },
		);
		expect(warning).toContain('DEV_BROWSER_PREVIEW_ORIGIN');
		expect(warning).toContain('403');
		expect(deployDevBrowserConsoleWarning({ DEV_BROWSER_SIDECAR_URL: 'http://127.0.0.1:9223' }))
			.toContain('DEV_BROWSER_SIDECAR_URL');
	});
});