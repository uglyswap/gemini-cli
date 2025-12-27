/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
} from '@google/genai';
import { GoogleGenAI } from '@google/genai';
import { createCodeAssistContentGenerator } from '../code_assist/codeAssist.js';
import type { Config } from '../config/config.js';
import { loadApiKey } from './apiKeyCredentialStorage.js';

import type { UserTierId } from '../code_assist/types.js';
import { LoggingContentGenerator } from './loggingContentGenerator.js';
import { InstallationManager } from '../utils/installationManager.js';
import { FakeContentGenerator } from './fakeContentGenerator.js';
import { parseCustomHeaders } from '../utils/customHeaderUtils.js';
import { RecordingContentGenerator } from './recordingContentGenerator.js';
import { getVersion, resolveModel } from '../../index.js';

/**
 * Interface abstracting the core functionalities for generating content and counting tokens.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;

  userTier?: UserTierId;
}

export enum AuthType {
  LOGIN_WITH_GOOGLE = 'oauth-personal',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  LEGACY_CLOUD_SHELL = 'cloud-shell',
  COMPUTE_ADC = 'compute-default-credentials',
  /** OpenAI-compatible providers (Z.AI, OpenRouter, Ollama, LM Studio, etc.) */
  USE_OPENAI_COMPATIBLE = 'openai-compatible',
}

export type ContentGeneratorConfig = {
  apiKey?: string;
  vertexai?: boolean;
  authType?: AuthType;
  proxy?: string;
  /** Base URL for OpenAI-compatible providers */
  openAICompatibleBaseUrl?: string;
  /** Model name override for OpenAI-compatible providers */
  openAICompatibleModel?: string;
};

/**
 * Checks if OpenAI-compatible provider is configured via environment variables
 */
export function isOpenAICompatibleConfigured(): boolean {
  return !!(
    process.env['OPENAI_COMPATIBLE_BASE_URL'] ||
    process.env['OPENROUTER_BASE_URL']
  );
}

/**
 * Gets the OpenAI-compatible auth type from environment if configured
 */
export function getOpenAICompatibleAuthType(): AuthType | undefined {
  if (isOpenAICompatibleConfigured()) {
    return AuthType.USE_OPENAI_COMPATIBLE;
  }
  return undefined;
}

export async function createContentGeneratorConfig(
  config: Config,
  authType: AuthType | undefined,
): Promise<ContentGeneratorConfig> {
  const geminiApiKey =
    process.env['GEMINI_API_KEY'] || (await loadApiKey()) || undefined;
  const googleApiKey = process.env['GOOGLE_API_KEY'] || undefined;
  const googleCloudProject =
    process.env['GOOGLE_CLOUD_PROJECT'] ||
    process.env['GOOGLE_CLOUD_PROJECT_ID'] ||
    undefined;
  const googleCloudLocation = process.env['GOOGLE_CLOUD_LOCATION'] || undefined;

  // OpenAI-compatible provider configuration
  const openAICompatibleApiKey =
    process.env['OPENAI_COMPATIBLE_API_KEY'] ||
    process.env['OPENROUTER_API_KEY'] ||
    undefined;
  const openAICompatibleBaseUrl =
    process.env['OPENAI_COMPATIBLE_BASE_URL'] ||
    process.env['OPENROUTER_BASE_URL'] ||
    undefined;
  const openAICompatibleModel =
    process.env['OPENAI_COMPATIBLE_MODEL'] || undefined;

  const contentGeneratorConfig: ContentGeneratorConfig = {
    authType,
    proxy: config?.getProxy(),
  };

  // OpenAI-compatible providers take priority when configured
  if (authType === AuthType.USE_OPENAI_COMPATIBLE && openAICompatibleBaseUrl) {
    contentGeneratorConfig.apiKey = openAICompatibleApiKey;
    contentGeneratorConfig.openAICompatibleBaseUrl = openAICompatibleBaseUrl;
    contentGeneratorConfig.openAICompatibleModel = openAICompatibleModel;
    return contentGeneratorConfig;
  }

  // If we are using Google auth or we are in Cloud Shell, there is nothing else to validate for now
  if (
    authType === AuthType.LOGIN_WITH_GOOGLE ||
    authType === AuthType.COMPUTE_ADC
  ) {
    return contentGeneratorConfig;
  }

  if (authType === AuthType.USE_GEMINI && geminiApiKey) {
    contentGeneratorConfig.apiKey = geminiApiKey;
    contentGeneratorConfig.vertexai = false;

    return contentGeneratorConfig;
  }

  if (
    authType === AuthType.USE_VERTEX_AI &&
    (googleApiKey || (googleCloudProject && googleCloudLocation))
  ) {
    contentGeneratorConfig.apiKey = googleApiKey;
    contentGeneratorConfig.vertexai = true;

    return contentGeneratorConfig;
  }

  return contentGeneratorConfig;
}

export async function createContentGenerator(
  config: ContentGeneratorConfig,
  gcConfig: Config,
  sessionId?: string,
): Promise<ContentGenerator> {
  const generator = await (async () => {
    if (gcConfig.fakeResponses) {
      return FakeContentGenerator.fromFile(gcConfig.fakeResponses);
    }

    // Handle OpenAI-compatible providers (Z.AI, OpenRouter, Ollama, etc.)
    if (
      config.authType === AuthType.USE_OPENAI_COMPATIBLE &&
      config.openAICompatibleBaseUrl
    ) {
      const { createOpenAICompatibleContentGenerator } = await import(
        './openAICompatibleGenerator.js'
      );
      const version = await getVersion();
      const model = resolveModel(
        gcConfig.getModel(),
        gcConfig.getPreviewFeatures(),
      );
      return new LoggingContentGenerator(
        createOpenAICompatibleContentGenerator(
          {
            ...config,
            model,
            openAICompatibleBaseUrl: config.openAICompatibleBaseUrl,
            openAICompatibleModel: config.openAICompatibleModel,
          },
          {
            headers: {
              'User-Agent': `GeminiCLI/${version}/${model} (${process.platform}; ${process.arch})`,
            },
          },
        ),
        gcConfig,
      );
    }

    const version = await getVersion();
    const model = resolveModel(
      gcConfig.getModel(),
      gcConfig.getPreviewFeatures(),
    );
    const customHeadersEnv =
      process.env['GEMINI_CLI_CUSTOM_HEADERS'] || undefined;
    const userAgent = `GeminiCLI/${version}/${model} (${process.platform}; ${process.arch})`;
    const customHeadersMap = parseCustomHeaders(customHeadersEnv);
    const apiKeyAuthMechanism =
      process.env['GEMINI_API_KEY_AUTH_MECHANISM'] || 'x-goog-api-key';

    const baseHeaders: Record<string, string> = {
      ...customHeadersMap,
      'User-Agent': userAgent,
    };

    if (
      apiKeyAuthMechanism === 'bearer' &&
      (config.authType === AuthType.USE_GEMINI ||
        config.authType === AuthType.USE_VERTEX_AI) &&
      config.apiKey
    ) {
      baseHeaders['Authorization'] = `Bearer ${config.apiKey}`;
    }
    if (
      config.authType === AuthType.LOGIN_WITH_GOOGLE ||
      config.authType === AuthType.COMPUTE_ADC
    ) {
      const httpOptions = { headers: baseHeaders };
      return new LoggingContentGenerator(
        await createCodeAssistContentGenerator(
          httpOptions,
          config.authType,
          gcConfig,
          sessionId,
        ),
        gcConfig,
      );
    }

    if (
      config.authType === AuthType.USE_GEMINI ||
      config.authType === AuthType.USE_VERTEX_AI
    ) {
      let headers: Record<string, string> = { ...baseHeaders };
      if (gcConfig?.getUsageStatisticsEnabled()) {
        const installationManager = new InstallationManager();
        const installationId = installationManager.getInstallationId();
        headers = {
          ...headers,
          'x-gemini-api-privileged-user-id': `${installationId}`,
        };
      }
      const httpOptions = { headers };

      const googleGenAI = new GoogleGenAI({
        apiKey: config.apiKey === '' ? undefined : config.apiKey,
        vertexai: config.vertexai,
        httpOptions,
      });
      return new LoggingContentGenerator(googleGenAI.models, gcConfig);
    }
    throw new Error(
      `Error creating contentGenerator: Unsupported authType: ${config.authType}`,
    );
  })();

  if (gcConfig.recordResponses) {
    return new RecordingContentGenerator(generator, gcConfig.recordResponses);
  }

  return generator;
}
