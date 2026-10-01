import {
	AI_MODEL_CONFIG,
	isValidAIModel,
	ModelSize,
	type AIModelConfig,
} from '../inferutils/config.types';

/**
 * Upstream Think model. Used when `THINK_MODEL` is unset or blank, so a
 * deployment that does not set the variable behaves exactly as upstream.
 */
export const THINK_MODEL_ID = 'google-ai-studio/gemini-3.6-flash';

export const THINK_MODEL_CONFIG: AIModelConfig = {
	name: 'Gemini 3.6 Flash',
	size: ModelSize.REGULAR,
	provider: 'google-ai-studio',
	creditCost: 2,
	contextSize: 1_048_576,
};

/**
 * Provider slugs accepted by AI Gateway's OpenAI-compatible
 * `/compat/chat/completions` endpoint. The model field is `{provider}/{model}`
 * (the provider is not a separate URL segment). See
 * https://developers.cloudflare.com/ai-gateway/usage/chat-completion/
 *
 * `custom-{slug}` is also accepted. Native-only providers (OpenRouter, Bedrock,
 * Azure, Hugging Face) are intentionally absent: Think always calls `/compat`.
 */
export const AI_GATEWAY_COMPAT_PROVIDERS = [
	'anthropic',
	'baseten',
	'cerebras',
	'cohere',
	'deepseek',
	'dynamic',
	'google-ai-studio',
	'google-vertex-ai',
	'grok',
	'groq',
	'mistral',
	'openai',
	'parallel',
	'perplexity-ai',
	'workers-ai',
] as const;

const COMPAT_PROVIDER_SET: ReadonlySet<string> = new Set(AI_GATEWAY_COMPAT_PROVIDERS);

const CUSTOM_PROVIDER = /^custom-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MODEL_PART = /^[A-Za-z0-9@][A-Za-z0-9@._+:/-]{0,240}$/;
const WORKERS_AI_MODEL =
	/^@(?:cf|hf)\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,80})+$/;

const MAX_MODEL_ID_LENGTH = 300;

const PROVIDER_HINTS: Readonly<Record<string, string>> = {
	google: 'use "google-ai-studio"',
	gemini: 'use "google-ai-studio"',
	xai: 'use "grok"',
	'x-ai': 'use "grok"',
	perplexity: 'use "perplexity-ai"',
	workersai: 'use "workers-ai", or pass the model as @cf/<org>/<model>',
	workers_ai: 'use "workers-ai", or pass the model as @cf/<org>/<model>',
	cloudflare: 'use "workers-ai", or pass the model as @cf/<org>/<model>',
	openrouter: 'OpenRouter is not on the OpenAI-compatible endpoint Think uses',
	bedrock: 'Amazon Bedrock is not on the OpenAI-compatible endpoint Think uses',
	azure: 'Azure OpenAI is not on the OpenAI-compatible endpoint Think uses',
	'azure-openai': 'Azure OpenAI is not on the OpenAI-compatible endpoint Think uses',
	huggingface: 'Hugging Face is not on the OpenAI-compatible endpoint Think uses',
};

export class ThinkModelConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ThinkModelConfigError';
	}
}

export interface ResolvedThinkModel {
	/** Value sent as the chat-completions `model` field (`provider/model`). */
	modelId: string;
	config: AIModelConfig;
}

/**
 * Resolve the Think model from the `THINK_MODEL` var.
 *
 * - Unset, blank, or the upstream id keeps {@link THINK_MODEL_ID} and
 *   {@link THINK_MODEL_CONFIG} (same object).
 * - `@cf/...` and `@hf/...` are Workers AI ids. They are normalized to
 *   `workers-ai/@cf/...` so the existing AI Gateway `/compat` request can
 *   route them. `workers-ai/@cf/...` is accepted as-is.
 * - Any other value must be `{provider}/{model}` for a provider on the
 *   OpenAI-compatible endpoint, or `custom-{slug}/{model}`.
 *
 * Throws {@link ThinkModelConfigError} for an invalid or unsupported value.
 * Call this when the Think session is created, before any model request.
 */
export function resolveThinkModel(raw: string | null | undefined): ResolvedThinkModel {
	const trimmed = typeof raw === 'string' ? raw.trim() : '';
	if (trimmed.length === 0 || trimmed === THINK_MODEL_ID) {
		return { modelId: THINK_MODEL_ID, config: THINK_MODEL_CONFIG };
	}

	const modelId = normalizeWorkersAiModelId(trimmed);
	assertValidThinkModelId(modelId, trimmed);
	return { modelId, config: configForThinkModel(modelId) };
}

function normalizeWorkersAiModelId(modelId: string): string {
	if (modelId.startsWith('@cf/') || modelId.startsWith('@hf/')) {
		return `workers-ai/${modelId}`;
	}
	return modelId;
}

function configForThinkModel(modelId: string): AIModelConfig {
	if (isValidAIModel(modelId)) {
		return AI_MODEL_CONFIG[modelId];
	}
	const provider = modelId.slice(0, modelId.indexOf('/'));
	return {
		name: modelId,
		size: ModelSize.REGULAR,
		provider,
		creditCost: THINK_MODEL_CONFIG.creditCost,
		contextSize: THINK_MODEL_CONFIG.contextSize,
	};
}

function assertValidThinkModelId(modelId: string, original: string): void {
	if (modelId.length > MAX_MODEL_ID_LENGTH || hasControlOrSpace(modelId)) {
		throw invalid(
			original,
			'the value must be a single model id with no spaces',
		);
	}

	const slash = modelId.indexOf('/');
	if (slash <= 0 || slash === modelId.length - 1) {
		throw invalid(
			original,
			'expected provider/model, for example google-ai-studio/<model> or workers-ai/@cf/<org>/<model>',
		);
	}

	const provider = modelId.slice(0, slash);
	const model = modelId.slice(slash + 1);
	const providerKey = provider.toLowerCase();

	if (!isSupportedProvider(provider)) {
		if (provider !== providerKey && (COMPAT_PROVIDER_SET.has(providerKey) || CUSTOM_PROVIDER.test(providerKey))) {
			throw invalid(original, `provider "${provider}" must be lowercase ("${providerKey}")`);
		}
		const hint = PROVIDER_HINTS[providerKey];
		const hintText = hint ? ` ${hint}.` : '';
		throw invalid(
			original,
			`provider "${provider}" is not supported by the AI Gateway OpenAI-compatible endpoint Think uses.${hintText} Supported providers: ${supportedProviderList()}`,
		);
	}

	if (!isSafeModelPart(model)) {
		throw invalid(original, `model "${preview(model)}" is not a valid model id`);
	}

	if (provider === 'workers-ai' && !WORKERS_AI_MODEL.test(model)) {
		throw invalid(
			original,
			'Workers AI models must look like workers-ai/@cf/<org>/<model> or workers-ai/@hf/<org>/<model> (a bare @cf/<org>/<model> is also accepted)',
		);
	}
}

function hasControlOrSpace(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 0x20 || code === 0x7f) return true;
	}
	return false;
}

function isSupportedProvider(provider: string): boolean {
	return COMPAT_PROVIDER_SET.has(provider) || CUSTOM_PROVIDER.test(provider);
}

function isSafeModelPart(model: string): boolean {
	if (!MODEL_PART.test(model)) return false;
	if (model.includes('..') || model.includes('//')) return false;
	if (model.startsWith('/') || model.endsWith('/')) return false;
	return true;
}

function supportedProviderList(): string {
	return `${AI_GATEWAY_COMPAT_PROVIDERS.join(', ')}, custom-{slug}`;
}

function invalid(original: string, reason: string): ThinkModelConfigError {
	return new ThinkModelConfigError(
		`Invalid THINK_MODEL "${preview(original)}": ${reason}. Leave THINK_MODEL unset to keep the default model.`,
	);
}

function preview(value: string): string {
	const compact = value.replace(/\s+/g, ' ');
	return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}
