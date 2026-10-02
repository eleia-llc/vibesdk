import { describe, expect, it } from 'vitest';
import { validateRenderMode } from './types';

describe('validateRenderMode', () => {
	it('accepts an omitted renderMode for every behavior', () => {
		expect(validateRenderMode(undefined, 'phasic')).toBeNull();
		expect(validateRenderMode(undefined, 'think')).toBeNull();
	});

	it('accepts static for think', () => {
		expect(validateRenderMode('static', 'think')).toBeNull();
		expect(validateRenderMode('spa', 'agentic')).toBeNull();
	});

	it('rejects static outside think, where nothing would enforce it', () => {
		expect(validateRenderMode('static', 'phasic')).toBe('renderMode "static" requires behaviorType "think"');
	});

	it('rejects unknown values', () => {
		expect(validateRenderMode('ssr', 'think')).toBe('Invalid "renderMode": expected one of spa, static');
		expect(validateRenderMode(true, 'think')).toBe('Invalid "renderMode": expected one of spa, static');
	});
});
