/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const PREVIEW_GEMINI_MODEL = 'gemini-3-pro-preview';
export const PREVIEW_GEMINI_FLASH_MODEL = 'gemini-3-flash-preview';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';
export const DEFAULT_GEMINI_FLASH_MODEL = 'gemini-2.5-flash';
export const DEFAULT_GEMINI_FLASH_LITE_MODEL = 'gemini-2.5-flash-lite';

// OpenAI-compatible provider models
export const ZAI_GLM_MODEL = 'glm-4.7';
export const ZAI_GLM_FLASH_MODEL = 'glm-4-flash';

export const VALID_GEMINI_MODELS = new Set([
  PREVIEW_GEMINI_MODEL,
  PREVIEW_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
]);

// Models supported via OpenAI-compatible providers
export const OPENAI_COMPATIBLE_MODELS = new Set([
  ZAI_GLM_MODEL,
  ZAI_GLM_FLASH_MODEL,
  // OpenRouter models
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4o',
  // Ollama models
  'llama3.2',
  'llama3.1',
  'codellama',
  'mistral',
  'mixtral',
  'phi3',
  'qwen2.5',
  'deepseek-coder',
]);

export const PREVIEW_GEMINI_MODEL_AUTO = 'auto-gemini-3';
export const DEFAULT_GEMINI_MODEL_AUTO = 'auto-gemini-2.5';

// Model aliases for user convenience.
export const GEMINI_MODEL_ALIAS_AUTO = 'auto';
export const GEMINI_MODEL_ALIAS_PRO = 'pro';
export const GEMINI_MODEL_ALIAS_FLASH = 'flash';
export const GEMINI_MODEL_ALIAS_FLASH_LITE = 'flash-lite';

// OpenAI-compatible model aliases
export const ZAI_MODEL_ALIAS = 'glm';
export const ZAI_MODEL_ALIAS_FLASH = 'glm-flash';

export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';

// Cap the thinking at 8192 to prevent run-away thinking loops.
export const DEFAULT_THINKING_MODE = 8192;

/**
 * Resolves the requested model alias (e.g., 'auto-gemini-3', 'pro', 'flash', 'flash-lite')
 * to a concrete model name, considering preview features.
 *
 * @param requestedModel The model alias or concrete model name requested by the user.
 * @param previewFeaturesEnabled A boolean indicating if preview features are enabled.
 * @returns The resolved concrete model name.
 */
export function resolveModel(
  requestedModel: string,
  previewFeaturesEnabled: boolean = false,
): string {
  switch (requestedModel) {
    case PREVIEW_GEMINI_MODEL_AUTO: {
      return PREVIEW_GEMINI_MODEL;
    }
    case DEFAULT_GEMINI_MODEL_AUTO: {
      return DEFAULT_GEMINI_MODEL;
    }
    case GEMINI_MODEL_ALIAS_PRO: {
      return previewFeaturesEnabled
        ? PREVIEW_GEMINI_MODEL
        : DEFAULT_GEMINI_MODEL;
    }
    case GEMINI_MODEL_ALIAS_FLASH: {
      return previewFeaturesEnabled
        ? PREVIEW_GEMINI_FLASH_MODEL
        : DEFAULT_GEMINI_FLASH_MODEL;
    }
    case GEMINI_MODEL_ALIAS_FLASH_LITE: {
      return DEFAULT_GEMINI_FLASH_LITE_MODEL;
    }
    // Z.AI / GLM model aliases
    case ZAI_MODEL_ALIAS: {
      return ZAI_GLM_MODEL;
    }
    case ZAI_MODEL_ALIAS_FLASH: {
      return ZAI_GLM_FLASH_MODEL;
    }
    default: {
      return requestedModel;
    }
  }
}

/**
 * Resolves the appropriate model based on the classifier's decision.
 *
 * @param requestedModel The current requested model (e.g. auto-gemini-2.5).
 * @param modelAlias The alias selected by the classifier ('flash' or 'pro').
 * @param previewFeaturesEnabled Whether preview features are enabled.
 * @returns The resolved concrete model name.
 */
export function resolveClassifierModel(
  requestedModel: string,
  modelAlias: string,
  previewFeaturesEnabled: boolean = false,
): string {
  if (modelAlias === GEMINI_MODEL_ALIAS_FLASH) {
    if (
      requestedModel === DEFAULT_GEMINI_MODEL_AUTO ||
      requestedModel === DEFAULT_GEMINI_MODEL
    ) {
      return DEFAULT_GEMINI_FLASH_MODEL;
    }
    if (
      requestedModel === PREVIEW_GEMINI_MODEL_AUTO ||
      requestedModel === PREVIEW_GEMINI_MODEL
    ) {
      return PREVIEW_GEMINI_FLASH_MODEL;
    }
    return resolveModel(GEMINI_MODEL_ALIAS_FLASH, previewFeaturesEnabled);
  }
  return resolveModel(requestedModel, previewFeaturesEnabled);
}
export function getDisplayString(
  model: string,
  previewFeaturesEnabled: boolean = false,
) {
  switch (model) {
    case PREVIEW_GEMINI_MODEL_AUTO:
      return 'Auto (Gemini 3)';
    case DEFAULT_GEMINI_MODEL_AUTO:
      return 'Auto (Gemini 2.5)';
    case GEMINI_MODEL_ALIAS_PRO:
      return `Manual (${
        previewFeaturesEnabled ? PREVIEW_GEMINI_MODEL : DEFAULT_GEMINI_MODEL
      })`;
    case GEMINI_MODEL_ALIAS_FLASH:
      return `Manual (${
        previewFeaturesEnabled
          ? PREVIEW_GEMINI_FLASH_MODEL
          : DEFAULT_GEMINI_FLASH_MODEL
      })`;
    case ZAI_GLM_MODEL:
    case ZAI_MODEL_ALIAS:
      return 'Z.AI (GLM-4.7)';
    case ZAI_GLM_FLASH_MODEL:
    case ZAI_MODEL_ALIAS_FLASH:
      return 'Z.AI (GLM-4-Flash)';
    default:
      return `Manual (${model})`;
  }
}

/**
 * Checks if the model is a preview model.
 *
 * @param model The model name to check.
 * @returns True if the model is a preview model.
 */
export function isPreviewModel(model: string): boolean {
  return (
    model === PREVIEW_GEMINI_MODEL ||
    model === PREVIEW_GEMINI_FLASH_MODEL ||
    model === PREVIEW_GEMINI_MODEL_AUTO
  );
}

/**
 * Checks if the model is a Gemini 2.x model.
 *
 * @param model The model name to check.
 * @returns True if the model is a Gemini-2.x model.
 */
export function isGemini2Model(model: string): boolean {
  return /^gemini-2(\.|$)/.test(model);
}

/**
 * Checks if the model is an OpenAI-compatible provider model.
 *
 * @param model The model name to check.
 * @returns True if the model is from an OpenAI-compatible provider.
 */
export function isOpenAICompatibleModel(model: string): boolean {
  return (
    OPENAI_COMPATIBLE_MODELS.has(model) ||
    model.startsWith('glm-') ||
    model.includes('/') || // OpenRouter format: provider/model
    model.startsWith('llama') ||
    model.startsWith('mistral') ||
    model.startsWith('phi') ||
    model.startsWith('qwen') ||
    model.startsWith('deepseek')
  );
}

/**
 * Checks if the model supports multimodal function responses (multimodal data nested within function response).
 * This is supported in Gemini 3.
 *
 * @param model The model name to check.
 * @returns True if the model supports multimodal function responses.
 */
export function supportsMultimodalFunctionResponse(model: string): boolean {
  return model.startsWith('gemini-3-');
}
