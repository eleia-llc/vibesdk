import type { PreviewType } from "../../../services/sandbox/sandboxTypes";
import type { ImageAttachment } from '../../../types/image-attachment';
import { RENDER_MODES, isRenderMode, type BehaviorType, type ProjectType, type RenderMode } from '../../../agents/core/types';
export { RENDER_MODES, isRenderMode, type RenderMode } from '../../../agents/core/types';
import type { CredentialsPayload } from '../../../agents/inferutils/config.types';

export const MAX_AGENT_QUERY_LENGTH = 20_000;

/**
 * Validate a requested `renderMode`. It must be a known value, and only the
 * think behavior honors a non-default one (its SpaceDO enforces it on every
 * deploy). Returns an error message, or null when the request is valid.
 */
export function validateRenderMode(renderMode: unknown, behaviorType: BehaviorType): string | null {
    if (renderMode === undefined) return null;
    if (!isRenderMode(renderMode)) {
        return `Invalid "renderMode": expected one of ${RENDER_MODES.join(', ')}`;
    }
    if (renderMode !== 'spa' && behaviorType !== 'think') {
        return `renderMode "${renderMode}" requires behaviorType "think"`;
    }
    return null;
}

export interface CodeGenArgs {
    query: string;
    language?: string;
    frameworks?: string[];
    selectedTemplate?: string;
    behaviorType?: BehaviorType;
    projectType?: ProjectType;
    images?: ImageAttachment[];
    /** See {@link RenderMode}. Defaults to `spa`. */
    renderMode?: RenderMode;

    /** Optional ephemeral credentials (BYOK / gateway override) for sdk */
    credentials?: CredentialsPayload;
}

/**
 * Data structure for connectToExistingAgent response
 */
export interface AgentConnectionData {
    websocketUrl: string;
    agentId: string;
}

export type AgentPreviewResponse = PreviewType;
