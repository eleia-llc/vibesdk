import { describe, expect, it } from 'vitest';
import {
	isMainPlatformHostname,
	isWorkersDevHostname,
	omitBlankPlatformDomainVars,
	resolveProdSecretValue,
} from './urls';

describe('workers.dev platform host', () => {
	it('recognizes a worker hostname and rejects the zone apex', () => {
		expect(isWorkersDevHostname('vibesdk-eval.eleia.workers.dev')).toBe(true);
		expect(isWorkersDevHostname('vibesdk-eval.eleia.workers.dev:443')).toBe(true);
		expect(isWorkersDevHostname('workers.dev')).toBe(false);
		expect(isWorkersDevHostname('eleia.workers.dev')).toBe(false);
		expect(isWorkersDevHostname('build.cloudflare.dev')).toBe(false);
	});

	it('treats workers.dev as the platform only when CUSTOM_DOMAIN is empty', () => {
		expect(isMainPlatformHostname('vibesdk-eval.eleia.workers.dev', { CUSTOM_DOMAIN: '' })).toBe(true);
		expect(isMainPlatformHostname('localhost', { CUSTOM_DOMAIN: '' })).toBe(true);
		expect(isMainPlatformHostname('1.2.3.4', { CUSTOM_DOMAIN: '' })).toBe(false);
		expect(
			isMainPlatformHostname('vibesdk-eval.eleia.workers.dev', { CUSTOM_DOMAIN: 'build.cloudflare.dev' }),
		).toBe(false);
		expect(isMainPlatformHostname('build.cloudflare.dev', { CUSTOM_DOMAIN: 'build.cloudflare.dev' })).toBe(true);
	});
});

describe('deploy var preservation', () => {
	it('omits a blank custom domain and keeps a real one', () => {
		const blank = omitBlankPlatformDomainVars({
			CUSTOM_DOMAIN: '',
			CUSTOM_PREVIEW_DOMAIN: '   ',
			DISPATCH_NAMESPACE: 'vibesdk-default-namespace',
		});
		expect(blank.omitted).toEqual({ CUSTOM_DOMAIN: '', CUSTOM_PREVIEW_DOMAIN: '   ' });
		expect(blank.vars).toEqual({ DISPATCH_NAMESPACE: 'vibesdk-default-namespace' });

		const set = omitBlankPlatformDomainVars({ CUSTOM_DOMAIN: 'build.cloudflare.dev' });
		expect(set.omitted).toEqual({});
		expect(set.vars.CUSTOM_DOMAIN).toBe('build.cloudflare.dev');
	});

	it('uploads an existing JWT_SECRET and generates one only when absent', () => {
		expect(resolveProdSecretValue('JWT_SECRET', { JWT_SECRET: 'already-set' }, undefined)).toBe(
			'already-set',
		);
		expect(resolveProdSecretValue('JWT_SECRET', {}, 'generated')).toBe('generated');
		expect(resolveProdSecretValue('OPENAI_API_KEY', { OPENAI_API_KEY: '' }, 'generated')).toBeUndefined();
		expect(resolveProdSecretValue('OPENAI_API_KEY', { OPENAI_API_KEY: 'sk-test' }, 'generated')).toBe(
			'sk-test',
		);
	});
});
