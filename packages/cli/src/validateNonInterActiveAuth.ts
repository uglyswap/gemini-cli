/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@google/gemini-cli-core';
import {
  AuthType,
  debugLogger,
  OutputFormat,
  ExitCodes,
  isOpenAICompatibleConfigured,
  getOpenAICompatibleAuthType,
} from '@google/gemini-cli-core';
import { USER_SETTINGS_PATH } from './config/settings.js';
import { validateAuthMethod } from './config/auth.js';
import { type LoadedSettings } from './config/settings.js';
import { handleError } from './utils/errors.js';
import { runExitCleanup } from './utils/cleanup.js';

function getAuthTypeFromEnv(): AuthType | undefined {
  // OpenAI-compatible providers take priority (Z.AI, OpenRouter, Ollama, etc.)
  const openAICompatibleAuth = getOpenAICompatibleAuthType();
  if (openAICompatibleAuth) {
    return openAICompatibleAuth;
  }

  if (process.env['GOOGLE_GENAI_USE_GCA'] === 'true') {
    return AuthType.LOGIN_WITH_GOOGLE;
  }
  if (process.env['GOOGLE_GENAI_USE_VERTEXAI'] === 'true') {
    return AuthType.USE_VERTEX_AI;
  }
  if (process.env['GEMINI_API_KEY']) {
    return AuthType.USE_GEMINI;
  }
  return undefined;
}

export async function validateNonInteractiveAuth(
  configuredAuthType: AuthType | undefined,
  useExternalAuth: boolean | undefined,
  nonInteractiveConfig: Config,
  settings: LoadedSettings,
) {
  try {
    const effectiveAuthType = configuredAuthType || getAuthTypeFromEnv();

    // OpenAI-compatible providers bypass enforcement and validation
    if (effectiveAuthType === AuthType.USE_OPENAI_COMPATIBLE) {
      await nonInteractiveConfig.refreshAuth(effectiveAuthType);
      return nonInteractiveConfig;
    }

    const enforcedType = settings.merged.security?.auth?.enforcedType;
    if (enforcedType && effectiveAuthType !== enforcedType) {
      const message = effectiveAuthType
        ? `The enforced authentication type is '${enforcedType}', but the current type is '${effectiveAuthType}'. Please re-authenticate with the correct type.`
        : `The auth type '${enforcedType}' is enforced, but no authentication is configured.`;
      throw new Error(message);
    }

    if (!effectiveAuthType) {
      // Check if OpenAI-compatible is configured but missing
      if (isOpenAICompatibleConfigured()) {
        throw new Error(
          'OpenAI-compatible provider URL is set but no API key found. Please set OPENAI_COMPATIBLE_API_KEY environment variable.',
        );
      }
      const message = `Please set an Auth method in your ${USER_SETTINGS_PATH} or specify one of the following environment variables before running: GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_GENAI_USE_GCA, or OPENAI_COMPATIBLE_BASE_URL with OPENAI_COMPATIBLE_API_KEY for external providers`;
      throw new Error(message);
    }

    const authType: AuthType = effectiveAuthType;

    if (!useExternalAuth) {
      const err = validateAuthMethod(String(authType));
      if (err != null) {
        throw new Error(err);
      }
    }

    await nonInteractiveConfig.refreshAuth(authType);
    return nonInteractiveConfig;
  } catch (error) {
    if (nonInteractiveConfig.getOutputFormat() === OutputFormat.JSON) {
      handleError(
        error instanceof Error ? error : new Error(String(error)),
        nonInteractiveConfig,
        ExitCodes.FATAL_AUTHENTICATION_ERROR,
      );
    } else {
      debugLogger.error(error instanceof Error ? error.message : String(error));
      await runExitCleanup();
      process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
    }
  }
}
