import {
	AI_MODEL_CONFIG,
	AIModels,
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
 * Context window and credit used when `THINK_MODEL` names a provider we accept
 * but the id is not in `AI_MODEL_CONFIG`. Gemini's 1M window and credit of 2
 * are the wrong stand-in: compaction then waits until the prompt is near 1M,
 * which is past the window of models such as glm-4.7 and glm-5.2, and the
 * call is metered as a cheap flash model.
 *
 * 128K is the conservative window. Credit 8 is intentionally higher than the
 * Gemini default so an unknown model is not under-metered. Override either
 * with `THINK_MODEL_CONTEXT_SIZE` / `THINK_MODEL_CREDIT_COST`. Those vars apply
 * only to ids missing from the catalog. The upstream default and catalog
 * entries ignore them.
 */
export const UNKNOWN_THINK_MODEL_CONTEXT_SIZE = 131_072;
export const UNKNOWN_THINK_MODEL_CREDIT_COST = 8;

/**
 * Values accepted by `THINK_REASONING_EFFORT`. These are the OpenAI chat
 * `reasoning_effort` levels Think can forward. Unset sends nothing.
 */
export const THINK_REASONING_EFFORTS = ['low', 'medium', 'high'] as const;

export type ThinkReasoningEffort = (typeof THINK_REASONING_EFFORTS)[number];

export interface ThinkModelLimits {
	contextSize?: string | number | null;
	creditCost?: string | number | null;
}

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
 *   route them. A repeated `workers-ai/` prefix is collapsed, and `@cf` /
 *   `@hf` / the `workers-ai` prefix are matched without regard to case.
 *   The catalog lookup uses that normalized id, then a case-insensitive
 *   match, and returns the catalog's own id.
 * - Any other value must be `{provider}/{model}` for a provider on the
 *   OpenAI-compatible endpoint, or `custom-{slug}/{model}`.
 *
 * Throws {@link ThinkModelConfigError} for an invalid or unsupported value.
 * Call this when the Think session is created, before any model request.
 *
 * `limits` overrides context and credit for ids that are not in the catalog.
 * They are ignored for the upstream default and for catalog entries.
 */
export function resolveThinkModel(
	raw: string | null | undefined,
	limits?: ThinkModelLimits,
): ResolvedThinkModel {
	const trimmed = typeof raw === 'string' ? unwrapQuotes(raw.trim()) : '';
	if (trimmed.length === 0 || trimmed === THINK_MODEL_ID) {
		return { modelId: THINK_MODEL_ID, config: THINK_MODEL_CONFIG };
	}

	const modelId = normalizeThinkModelId(trimmed);
	const catalogId = catalogModelId(modelId);
	if (catalogId) {
		return { modelId: catalogId, config: AI_MODEL_CONFIG[catalogId] };
	}
	assertValidThinkModelId(modelId, trimmed);
	return { modelId, config: configForThinkModel(modelId, limits) };
}

const THINK_REASONING_EFFORT_SET: ReadonlySet<string> = new Set(THINK_REASONING_EFFORTS);

/**
 * Resolve `THINK_REASONING_EFFORT` once, when the Think session is created.
 *
 * Unset or blank returns `undefined`. `beforeTurn` then omits
 * `providerOptions`, which is the upstream request. `low`, `medium`, and
 * `high` are stored on the session. Any other value throws
 * {@link ThinkModelConfigError} before a model request.
 */
export function resolveThinkReasoningEffort(
	raw: string | null | undefined,
): ThinkReasoningEffort | undefined {
	const trimmed = typeof raw === 'string' ? raw.trim() : '';
	if (trimmed.length === 0) return undefined;
	if (THINK_REASONING_EFFORT_SET.has(trimmed)) {
		return trimmed as ThinkReasoningEffort;
	}
	throw new ThinkModelConfigError(
		`Invalid THINK_REASONING_EFFORT "${preview(trimmed)}": expected low, medium, or high. Leave THINK_REASONING_EFFORT unset to send no reasoning_effort.`,
	);
}

/**
 * AI SDK `providerOptions` key for a language model id such as `openai.chat`.
 *
 * Think's `getModel()` uses `@ai-sdk/openai` chat completions. That model
 * copies `providerOptions.openai.reasoningEffort` onto the chat body field
 * `reasoning_effort`. The key is the SDK provider id, not the AI Gateway
 * slug (`workers-ai`, `google-ai-studio`, ...). When the language-model
 * provider id is not `openai`, the first segment is used instead.
 */
export function thinkReasoningProviderOptionsKey(languageModelProvider: string): string {
	const key = languageModelProvider.split('.')[0]?.trim() ?? '';
	return key.length > 0 ? key : 'openai';
}

/**
 * `providerOptions` for one turn. `undefined` means the turn config must
 * omit the field so an unset effort matches upstream.
 */
export function thinkTurnProviderOptions(
	reasoningEffort: ThinkReasoningEffort | undefined,
	languageModelProvider: string,
): Record<string, { reasoningEffort: ThinkReasoningEffort }> | undefined {
	if (!reasoningEffort) return undefined;
	return {
		[thinkReasoningProviderOptionsKey(languageModelProvider)]: { reasoningEffort },
	};
}

/**
 * Gateway model id for the system prompt. `modelName` is already
 * `provider/model` for Think (including `workers-ai/@cf/...`). Prefixing the
 * provider again produces `workers-ai/workers-ai/@cf/...`.
 */
export function formatThinkModelId(provider: string, modelName: string): string {
	if (!provider || modelName === provider || modelName.startsWith(`${provider}/`)) {
		return modelName;
	}
	return `${provider}/${modelName}`;
}

/**
 * Credit for a stored session. Does not re-read `env.THINK_MODEL`.
 * A catalog match uses the catalog credit, including a session that stored
 * the unknown-model default before the id was catalogued. Other ids keep
 * the credit saved at creation.
 */
export function creditCostForStoredThinkModel(model: {
	modelName?: string;
	creditCost?: number;
}): number {
	const catalogId = model.modelName ? catalogModelId(normalizeThinkModelId(model.modelName)) : undefined;
	if (catalogId) return AI_MODEL_CONFIG[catalogId].creditCost;
	if (typeof model.creditCost === 'number' && Number.isFinite(model.creditCost) && model.creditCost > 0) {
		return model.creditCost;
	}
	if (!model.modelName || model.modelName === THINK_MODEL_ID) {
		return THINK_MODEL_CONFIG.creditCost;
	}
	return UNKNOWN_THINK_MODEL_CREDIT_COST;
}

/**
 * Context window for a session that already stored a model id. A catalog
 * match wins over a previously stored unknown-model window (131072), so
 * adding `workers-ai/@cf/zai-org/glm-5.3` to the catalog takes effect
 * without a new app. Unknown ids keep the stored override.
 */
export function contextSizeForStoredThinkModel(model: {
	modelName?: string;
	contextSize?: number;
}): number {
	const catalogId = model.modelName ? catalogModelId(normalizeThinkModelId(model.modelName)) : undefined;
	if (catalogId) return AI_MODEL_CONFIG[catalogId].contextSize;
	if (!model.modelName || model.modelName === THINK_MODEL_ID) {
		return THINK_MODEL_CONFIG.contextSize;
	}
	if (typeof model.contextSize === 'number' && Number.isFinite(model.contextSize) && model.contextSize > 0) {
		return model.contextSize;
	}
	return UNKNOWN_THINK_MODEL_CONTEXT_SIZE;
}

function unwrapQuotes(value: string): string {
	if (value.length < 2) return value;
	const quote = value[0];
	if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
		return value.slice(1, -1).trim();
	}
	return value;
}

const WORKERS_AI_PREFIX = /^(?:workers[-_]?ai\/)+/i;

/**
 * Canonical gateway id before the catalog lookup.
 * Collapses a repeated Workers AI prefix, accepts `@cf` / `@hf` in any
 * case, and lowercases only that prefix. The rest of the model id keeps
 * its case so an unknown id is not rewritten before validation.
 */
export function normalizeThinkModelId(modelId: string): string {
	let id = modelId.trim();
	id = id.replace(WORKERS_AI_PREFIX, 'workers-ai/');
	if (/^@(?:cf|hf)\//i.test(id)) {
		id = `workers-ai/${id}`;
	}
	id = id.replace(/^workers-ai\/@(cf|hf)\//i, (_match, scope: string) => `workers-ai/@${scope.toLowerCase()}/`);
	return id;
}

function catalogModelId(modelId: string): AIModels | undefined {
	if (isValidAIModel(modelId)) return modelId;
	const folded = modelId.toLowerCase();
	for (const candidate of Object.values(AIModels)) {
		if (candidate.toLowerCase() === folded) return candidate;
	}
	return undefined;
}

function configForThinkModel(modelId: string, limits?: ThinkModelLimits): AIModelConfig {
	if (isValidAIModel(modelId)) {
		return AI_MODEL_CONFIG[modelId];
	}
	const provider = modelId.slice(0, modelId.indexOf('/'));
	return {
		name: modelId,
		size: ModelSize.REGULAR,
		provider,
		creditCost: parseThinkModelLimit(limits?.creditCost, 'THINK_MODEL_CREDIT_COST')
			?? UNKNOWN_THINK_MODEL_CREDIT_COST,
		contextSize: parseThinkModelLimit(limits?.contextSize, 'THINK_MODEL_CONTEXT_SIZE')
			?? UNKNOWN_THINK_MODEL_CONTEXT_SIZE,
	};
}

function parseThinkModelLimit(
	raw: string | number | null | undefined,
	name: string,
): number | undefined {
	if (raw == null) return undefined;
	const text = typeof raw === 'number' ? String(raw) : raw.trim();
	if (text.length === 0) return undefined;
	const value = Number(text);
	if (!Number.isFinite(value) || value <= 0) {
		throw new ThinkModelConfigError(
			`${name} must be a positive number. Got "${preview(text)}".`,
		);
	}
	return value;
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
