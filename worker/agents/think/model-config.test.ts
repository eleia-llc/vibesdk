import { describe, expect, it } from 'vitest';
import { AI_MODEL_CONFIG, AIModels, ModelSize } from '../inferutils/config.types';
import {
	AI_GATEWAY_COMPAT_PROVIDERS,
	THINK_MODEL_CONFIG,
	THINK_MODEL_ID,
	ThinkModelConfigError,
	UNKNOWN_THINK_MODEL_CONTEXT_SIZE,
	UNKNOWN_THINK_MODEL_CREDIT_COST,
	contextSizeForStoredThinkModel,
	creditCostForStoredThinkModel,
	formatThinkModelId,
	resolveThinkModel,
	resolveThinkReasoningEffort,
	thinkReasoningProviderOptionsKey,
	thinkTurnProviderOptions,
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
		expect(resolved.config.creditCost).toBe(UNKNOWN_THINK_MODEL_CREDIT_COST);
		expect(resolved.config.contextSize).toBe(UNKNOWN_THINK_MODEL_CONTEXT_SIZE);
		expect(resolved.config.contextSize).toBeLessThan(THINK_MODEL_CONFIG.contextSize);
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

	it('lets unknown models override context and credit without touching catalog entries', () => {
		const glm = resolveThinkModel('workers-ai/@cf/zai-org/glm-5.2', {
			contextSize: '200000',
			creditCost: '3',
		});
		expect(glm.config.contextSize).toBe(200_000);
		expect(glm.config.creditCost).toBe(3);

		const catalog = resolveThinkModel('openai/gpt-5', { contextSize: 4096, creditCost: 1 });
		expect(catalog.config).toBe(AI_MODEL_CONFIG[AIModels.OPENAI_5]);

		const upstream = resolveThinkModel(undefined, { contextSize: 4096, creditCost: 99 });
		expect(upstream.config).toBe(THINK_MODEL_CONFIG);
	});

	it('rejects a non-positive context or credit override', () => {
		expect(() => resolveThinkModel('@cf/zai-org/glm-4.7', { contextSize: '0' })).toThrow(
			/THINK_MODEL_CONTEXT_SIZE/,
		);
		expect(() => resolveThinkModel('@cf/zai-org/glm-4.7', { creditCost: 'nope' })).toThrow(
			/THINK_MODEL_CREDIT_COST/,
		);
	});

	it('does not prefix a model id that already includes its provider', () => {
		expect(formatThinkModelId('workers-ai', 'workers-ai/@cf/zai-org/glm-5.3-flash')).toBe(
			'workers-ai/@cf/zai-org/glm-5.3-flash',
		);
		expect(formatThinkModelId('google-ai-studio', 'google-ai-studio/gemini-3.6-flash')).toBe(
			'google-ai-studio/gemini-3.6-flash',
		);
		expect(formatThinkModelId('openai', 'gpt-5')).toBe('openai/gpt-5');
	});

	it('meters a stored session from the credit saved at creation', () => {
		expect(creditCostForStoredThinkModel({ modelName: THINK_MODEL_ID, creditCost: 2 })).toBe(2);
		expect(
			creditCostForStoredThinkModel({
				modelName: 'workers-ai/@cf/zai-org/glm-5.2',
				creditCost: 3,
			}),
		).toBe(3);
		expect(
			creditCostForStoredThinkModel({ modelName: 'workers-ai/@cf/zai-org/glm-5.2' }),
		).toBe(UNKNOWN_THINK_MODEL_CREDIT_COST);
		expect(creditCostForStoredThinkModel({ modelName: AIModels.OPENAI_5 })).toBe(5);
	});

	it('names the provider fix for common mistakes', () => {
		expect(() => resolveThinkModel('perplexity/sonar')).toThrow(/perplexity-ai/);
		expect(() => resolveThinkModel('xai/grok-4')).toThrow(/grok/);
		expect(() => resolveThinkModel('google/gemini-2.5-flash')).toThrow(/google-ai-studio/);
	});

	it('catalogues GLM 5.3 and GLM 5.3 Flash at 1M and ignores limit overrides', () => {
		const full = resolveThinkModel('@cf/zai-org/glm-5.3', { contextSize: 4096, creditCost: 1 });
		expect(full.modelId).toBe(AIModels.GLM_5_3);
		expect(full.modelId).toBe('workers-ai/@cf/zai-org/glm-5.3');
		expect(full.config).toBe(AI_MODEL_CONFIG[AIModels.GLM_5_3]);
		expect(full.config.contextSize).toBe(1_048_576);
		expect(full.config.creditCost).toBe(5.6);
		expect(full.config.provider).toBe('workers-ai');

		const flash = resolveThinkModel('workers-ai/@cf/zai-org/glm-5.3-flash');
		expect(flash.modelId).toBe(AIModels.GLM_5_3_FLASH);
		expect(flash.config).toBe(AI_MODEL_CONFIG[AIModels.GLM_5_3_FLASH]);
		expect(flash.config.contextSize).toBe(1_048_576);
		expect(flash.config.creditCost).toBe(0.6);

		expect(creditCostForStoredThinkModel({ modelName: AIModels.GLM_5_3 })).toBe(5.6);
		expect(creditCostForStoredThinkModel({ modelName: AIModels.GLM_5_3_FLASH })).toBe(0.6);
	});

	it('resolves the exact THINK_MODEL env value workers-ai/@cf/zai-org/glm-5.3 to 1M and credit 5.6', () => {
		const resolved = resolveThinkModel('workers-ai/@cf/zai-org/glm-5.3', {
			contextSize: '131072',
			creditCost: '8',
		});
		expect(resolved.modelId).toBe('workers-ai/@cf/zai-org/glm-5.3');
		expect(resolved.config).toBe(AI_MODEL_CONFIG[AIModels.GLM_5_3]);
		expect(resolved.config.contextSize).toBe(1_048_576);
		expect(resolved.config.creditCost).toBe(5.6);

		for (const raw of [
			'Workers-AI/@cf/zai-org/glm-5.3',
			'workers-ai/@CF/zai-org/GLM-5.3',
			'workers-ai/workers-ai/@cf/zai-org/glm-5.3',
			'"workers-ai/@cf/zai-org/glm-5.3"',
		]) {
			const variant = resolveThinkModel(raw);
			expect(variant.modelId).toBe('workers-ai/@cf/zai-org/glm-5.3');
			expect(variant.config.contextSize).toBe(1_048_576);
			expect(variant.config.creditCost).toBe(5.6);
		}

		expect(contextSizeForStoredThinkModel({
			modelName: 'workers-ai/@cf/zai-org/glm-5.3',
			contextSize: 131_072,
		})).toBe(1_048_576);
		expect(creditCostForStoredThinkModel({
			modelName: 'workers-ai/@cf/zai-org/glm-5.3',
			creditCost: 8,
		})).toBe(5.6);
	});
});

describe('resolveThinkReasoningEffort', () => {
	it('sends nothing when unset', () => {
		for (const raw of [undefined, null, '', '   ', '\n\t']) {
			expect(resolveThinkReasoningEffort(raw)).toBeUndefined();
			expect(thinkTurnProviderOptions(resolveThinkReasoningEffort(raw), 'openai.chat')).toBeUndefined();
		}
	});

	it('accepts low, medium, and high and trims them', () => {
		expect(resolveThinkReasoningEffort('low')).toBe('low');
		expect(resolveThinkReasoningEffort('  medium  ')).toBe('medium');
		expect(resolveThinkReasoningEffort('\nhigh\n')).toBe('high');
	});

	it('rejects any other value with the same configuration error as THINK_MODEL', () => {
		for (const sample of ['max', 'none', 'minimal', 'xhigh', 'LOW', 'High', '0', 'true']) {
			let thrown: unknown;
			try {
				resolveThinkReasoningEffort(sample);
			} catch (error) {
				thrown = error;
			}
			if (!(thrown instanceof ThinkModelConfigError)) {
				throw new Error(`${sample} should throw ThinkModelConfigError`);
			}
			expect(thrown.message).toContain('THINK_REASONING_EFFORT');
			expect(thrown.message).toContain('unset');
		}
	});

	it('maps the language-model provider id onto providerOptions', () => {
		expect(thinkReasoningProviderOptionsKey('openai.chat')).toBe('openai');
		expect(thinkReasoningProviderOptionsKey('openai')).toBe('openai');
		expect(thinkReasoningProviderOptionsKey('')).toBe('openai');
		expect(thinkReasoningProviderOptionsKey('anthropic.messages')).toBe('anthropic');

		expect(thinkTurnProviderOptions('medium', 'openai.chat')).toEqual({
			openai: { reasoningEffort: 'medium' },
		});
		expect(thinkTurnProviderOptions('low', 'workers-ai.chat')).toEqual({
			'workers-ai': { reasoningEffort: 'low' },
		});
	});
});
