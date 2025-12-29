/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getModelContextLimit,
  DEFAULT_TOKEN_LIMIT as SERVICE_DEFAULT,
} from '../services/modelContextService.js';

type Model = string;
type TokenCount = number;

export const DEFAULT_TOKEN_LIMIT = SERVICE_DEFAULT;

/**
 * Get the token limit for a model.
 * Uses the modelContextService to get cached/fetched limits,
 * with fallback to known Gemini model limits.
 */
export function tokenLimit(model: Model): TokenCount {
  // First check the model context service (handles OpenAI-compatible providers)
  const cachedLimit = getModelContextLimit(model);

  // If service found a non-default limit, use it
  if (cachedLimit !== SERVICE_DEFAULT) {
    return cachedLimit;
  }

  // Fallback to hardcoded Gemini limits for models the service doesn't know
  switch (model) {
    case 'gemini-1.5-pro':
      return 2_097_152;
    case 'gemini-1.5-flash':
    case 'gemini-2.5-pro-preview-05-06':
    case 'gemini-2.5-pro-preview-06-05':
    case 'gemini-2.5-pro':
    case 'gemini-2.5-flash-preview-05-20':
    case 'gemini-2.5-flash':
    case 'gemini-2.5-flash-lite':
    case 'gemini-2.0-flash':
      return 1_048_576;
    case 'gemini-2.0-flash-preview-image-generation':
      return 32_000;
    default:
      return DEFAULT_TOKEN_LIMIT;
  }
}
