import { describe, expect, it } from 'vitest';
import { AI_MODEL_CONFIG, AIModels, ModelSize } from '../inferutils/config.types';
import {
	AI_GATEWAY_COMPAT_PROVIDERS,
	THINK_MODEL_CONFIG,
	THINK_MODEL_ID,
	ThinkModelConfigError,
	resolveThinkModel,
} from './model-config';

describe('resolveThinkModel', () => {
	it('keeps the upstream model and config object when unset', () => {
		for (const raw of [undefined, null, '', '   ', '\n\t']) {
			const resolved = resolveThinkModel(raw);
			expect(resolved.modelId).toBe(THINK_MODEL_ID);
			expect(resolved.modelId).toBe('google-ai-studio/gemini-3.6-flash');
			expect(resolved.config).toBe(THINK_MODEL_CONFIG);
		}
		expect(THINK_MODEL_CONFIG).toEqual({
			name: 'Gemini 3.6 Flash',
			size: ModelSize.REGULAR,
			provider: 'google-ai-studio',
			creditCost: 2,
			contextSize: 1_048_576,
		});
	});

	it('treats the upstream id itself as the default', () => {
		const resolved = resolveThinkModel(`  ${THINK_MODEL_ID}  `);
		expect(resolved.modelId).toBe(THINK_MODEL_ID);
		expect(resolved.config).toBe(THINK_MODEL_CONFIG);
	});

	it('uses the catalog entry for a known gateway model id', () => {
		const resolved = resolveThinkModel('openai/gpt-5');
		expect(resolved.modelId).toBe(AIModels.OPENAI_5);
		expect(resolved.config).toBe(AI_MODEL_CONFIG[AIModels.OPENAI_5]);
		expect(resolved.config.provider).toBe('openai');
		expect(resolved.config.creditCost).toBe(5);
	});

	it('keeps multi-segment model ids for vertex-style providers', () => {
		const resolved = resolveThinkModel('google-vertex-ai/openai/gpt-oss-120b-maas');
		expect(resolved.modelId).toBe(AIModels.VERTEX_GPT_OSS_120);
		expect(resolved.config).toBe(AI_MODEL_CONFIG[AIModels.VERTEX_GPT_OSS_120]);
		expect(resolved.config.provider).toBe('google-vertex-ai');
	});

	it('accepts a Workers AI model on the compat endpoint', () => {
		const modelId = 'workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast';
		const resolved = resolveThinkModel(modelId);
		expect(resolved.modelId).toBe(modelId);
		expect(resolved.config.provider).toBe('workers-ai');
		expect(resolved.config.creditCost).toBe(THINK_MODEL_CONFIG.creditCost);
		expect(resolved.config.contextSize).toBe(THINK_MODEL_CONFIG.contextSize);
		expect(resolved.config.size).toBe(ModelSize.REGULAR);
	});

	it('normalizes a bare @cf or @hf id onto the workers-ai provider', () => {
		expect(resolveThinkModel('@cf/moonshotai/kimi-k2.6').modelId).toBe(
			'workers-ai/@cf/moonshotai/kimi-k2.6',
		);
		expect(resolveThinkModel('  @hf/nousresearch/hermes-2-pro-mistral-7b  ').modelId).toBe(
			'workers-ai/@hf/nousresearch/hermes-2-pro-mistral-7b',
		);
		expect(resolveThinkModel('@cf/zai-org/glm-5.2').config.provider).toBe('workers-ai');
	});

	it('accepts dynamic routes and custom providers', () => {
		expect(resolveThinkModel('dynamic/customer-support').config.provider).toBe('dynamic');
		expect(resolveThinkModel('custom-acme/my-model').config.provider).toBe('custom-acme');
		expect(resolveThinkModel('custom-my-endpoint/org/model-name').modelId).toBe(
			'custom-my-endpoint/org/model-name',
		);
	});

	it('accepts every documented compat provider slug', () => {
		for (const provider of AI_GATEWAY_COMPAT_PROVIDERS) {
			if (provider === 'workers-ai') continue;
			const resolved = resolveThinkModel(`${provider}/example-model`);
			expect(resolved.config.provider).toBe(provider);
		}
	});

	it('rejects an unsupported or malformed value', () => {
		const samples = [
			'openai',
			'not-a-provider/gpt-4',
			'OpenAI/gpt-4',
			'google/gemini-2.5-pro',
			'openrouter/some-model',
			'workers-ai/llama-3',
			'workers-ai/@cf',
			'@cf/only-one-segment',
			'@hf/only',
			'workers-ai/@cf/../secret',
			'workers-ai/@cf/meta/llama 3',
			'custom-/model',
			'https://example.com/v1',
			'../openai/gpt-4',
		];
		for (const sample of samples) {
			let thrown: unknown;
			try {
				resolveThinkModel(sample);
			} catch (error) {
				thrown = error;
			}
			if (!(thrown instanceof ThinkModelConfigError)) {
				throw new Error(`${sample} should throw ThinkModelConfigError`);
			}
			expect(thrown.message).toContain('THINK_MODEL');
			expect(thrown.message).toContain('unset');
		}
	});

	it('names the provider fix for common mistakes', () => {
		expect(() => resolveThinkModel('perplexity/sonar')).toThrow(/perplexity-ai/);
		expect(() => resolveThinkModel('xai/grok-4')).toThrow(/grok/);
		expect(() => resolveThinkModel('google/gemini-2.5-flash')).toThrow(/google-ai-studio/);
	});
});
