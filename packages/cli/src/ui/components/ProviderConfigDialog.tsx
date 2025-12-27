/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useKeypress } from '../hooks/useKeypress.js';
import { theme } from '../semantic-colors.js';
import { DescriptiveRadioButtonSelect } from './shared/DescriptiveRadioButtonSelect.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { TextInput } from './shared/TextInput.js';
import { useTextBuffer } from './shared/text-buffer.js';
import { useUIState } from '../contexts/UIStateContext.js';
import {
  getConfigManager,
  getModelRegistry,
  getProviderById,
  getProvidersByType,
  type ProviderDefinition,
  type ModelInfo,
} from '@google/gemini-cli-core';

type ConfigStep = 'provider' | 'apiKey' | 'baseUrl' | 'model' | 'success';

interface ProviderConfigDialogProps {
  onClose: () => void;
  initialProviderId?: string;
}

export function ProviderConfigDialog({
  onClose,
  initialProviderId,
}: ProviderConfigDialogProps): React.JSX.Element | null {
  const { mainAreaWidth } = useUIState();
  const viewportWidth = mainAreaWidth - 8;

  // Validate initialProviderId before using it
  const validatedInitialProvider = initialProviderId
    ? getProviderById(initialProviderId)
    : undefined;

  const [step, setStep] = useState<ConfigStep>(
    validatedInitialProvider ? 'apiKey' : 'provider',
  );
  const [selectedProvider, setSelectedProvider] =
    useState<ProviderDefinition | null>(validatedInitialProvider || null);
  const [apiKey, setApiKey] = useState<string>('');
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configManager = getConfigManager();
  const modelRegistry = getModelRegistry();

  // Ref for auto-close timeout cleanup
  const autoCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeout on unmount
  useEffect(
    () => () => {
      if (autoCloseTimeoutRef.current) {
        clearTimeout(autoCloseTimeoutRef.current);
      }
    },
    [],
  );

  // Text buffer for API key input
  const apiKeyBuffer = useTextBuffer({
    initialText: '',
    initialCursorOffset: 0,
    viewport: {
      width: viewportWidth,
      height: 4,
    },
    isValidPath: () => false,
    inputFilter: (text) =>
      text.replace(/[^a-zA-Z0-9_\-.:+/=]/g, '').replace(/[\r\n]/g, ''),
    singleLine: true,
  });

  // Text buffer for base URL input
  const baseUrlBuffer = useTextBuffer({
    initialText: '',
    initialCursorOffset: 0,
    viewport: {
      width: viewportWidth,
      height: 4,
    },
    isValidPath: () => false,
    inputFilter: (text) =>
      text.replace(/[^a-zA-Z0-9_\-.:+/=?&#]/g, '').replace(/[\r\n]/g, ''),
    singleLine: true,
  });

  // Handle escape key
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        if (step === 'provider' || step === 'success') {
          onClose();
        } else if (step === 'apiKey') {
          setStep('provider');
          setError(null);
        } else if (step === 'baseUrl') {
          if (selectedProvider?.requiresApiKey) {
            setStep('apiKey');
          } else {
            setStep('provider');
          }
          setError(null);
        } else if (step === 'model') {
          // Go back to baseUrl if custom provider, otherwise to apiKey or provider
          if (selectedProvider?.id === 'custom') {
            setStep('baseUrl');
          } else if (selectedProvider?.requiresApiKey) {
            setStep('apiKey');
          } else {
            setStep('provider');
          }
          setError(null);
        }
      }
    },
    { isActive: true },
  );

  // Build provider list with icons
  const providerItems = useMemo(() => {
    const { cloud, local } = getProvidersByType();
    const items: Array<{
      value: string;
      title: string;
      description: string;
      key: string;
    }> = [];

    // Cloud providers first
    for (const provider of cloud) {
      items.push({
        value: provider.id,
        title: `${provider.icon} ${provider.name}`,
        description: provider.description,
        key: provider.id,
      });
    }

    // Then local providers
    for (const provider of local) {
      items.push({
        value: provider.id,
        title: `${provider.icon} ${provider.name}`,
        description: provider.description,
        key: provider.id,
      });
    }

    return items;
  }, []);

  // Build model list
  const modelItems = useMemo(
    () =>
      models.map((model) => ({
        value: model.id,
        label: model.name || model.id,
        key: model.id,
      })),
    [models],
  );

  // Fetch models when provider is selected
  const fetchModels = useCallback(
    async (providerId: string, key?: string, customBaseUrl?: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const provider = getProviderById(providerId);
        if (!provider) {
          throw new Error(`Unknown provider: ${providerId}`);
        }

        const effectiveBaseUrl = customBaseUrl || provider.defaultBaseUrl;

        // Check if local provider is running
        if (provider.isLocal) {
          // Local providers should always have a base URL configured
          if (!effectiveBaseUrl) {
            throw new Error(
              `No base URL configured for local provider: ${providerId}`,
            );
          }

          if (providerId === 'ollama') {
            const isRunning =
              await modelRegistry.isOllamaRunning(effectiveBaseUrl);
            if (!isRunning) {
              throw new Error(
                'Ollama is not running. Start it with: ollama serve',
              );
            }
          } else if (providerId === 'lmstudio') {
            const isRunning =
              await modelRegistry.isLMStudioRunning(effectiveBaseUrl);
            if (!isRunning) {
              throw new Error(
                'LM Studio is not running. Start it and enable the local server.',
              );
            }
          }
        }

        const result = await modelRegistry.fetchModels(providerId, {
          apiKey: key,
          baseUrl: customBaseUrl,
          forceRefresh: true,
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to fetch models');
        }

        // If no models from API, use recommended models
        if (result.models.length === 0) {
          const recommended = modelRegistry.getRecommendedModels(providerId);
          if (recommended.length > 0) {
            setModels(recommended.map((id) => ({ id })));
          } else if (provider.hardcodedModels) {
            setModels(provider.hardcodedModels.map((id) => ({ id })));
          } else {
            throw new Error('No models available for this provider');
          }
        } else {
          setModels(result.models);
        }

        setStep('model');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        // Stay on current step
      } finally {
        setIsLoading(false);
      }
    },
    [modelRegistry],
  );

  // Handle provider selection
  const handleProviderSelect = useCallback(
    (providerId: string) => {
      const provider = getProviderById(providerId);
      if (!provider) return;

      setSelectedProvider(provider);
      setError(null);

      // Check if already configured
      const existingConfig = configManager.getProvider(providerId);
      if (existingConfig?.apiKey) {
        setApiKey(existingConfig.apiKey);
        apiKeyBuffer.setText(existingConfig.apiKey);
      }
      if (existingConfig?.baseUrl) {
        setBaseUrl(existingConfig.baseUrl);
        baseUrlBuffer.setText(existingConfig.baseUrl);
      }

      if (provider.requiresApiKey) {
        setStep('apiKey');
      } else {
        // Local providers don't need API key, go straight to models
        void fetchModels(providerId);
      }
    },
    [configManager, fetchModels, apiKeyBuffer, baseUrlBuffer],
  );

  // Handle API key submission
  const handleApiKeySubmit = useCallback(
    (key: string) => {
      if (!selectedProvider) return;

      const trimmedKey = key.trim();
      if (!trimmedKey) {
        setError('API key is required');
        return;
      }

      setApiKey(trimmedKey);

      // Custom provider needs baseUrl before fetching models
      if (selectedProvider.id === 'custom') {
        setStep('baseUrl');
      } else {
        void fetchModels(selectedProvider.id, trimmedKey);
      }
    },
    [selectedProvider, fetchModels],
  );

  // Handle base URL submission (for custom provider)
  const handleBaseUrlSubmit = useCallback(
    (url: string) => {
      if (!selectedProvider) return;

      const trimmedUrl = url.trim();
      if (!trimmedUrl) {
        setError('Base URL is required for custom provider');
        return;
      }

      // Basic URL validation
      try {
        new URL(trimmedUrl);
      } catch {
        setError('Invalid URL format. Example: https://api.example.com/v1');
        return;
      }

      setBaseUrl(trimmedUrl);
      void fetchModels(selectedProvider.id, apiKey, trimmedUrl);
    },
    [selectedProvider, apiKey, fetchModels],
  );

  // Handle model selection
  const handleModelSelect = useCallback(
    (modelId: string) => {
      if (!selectedProvider) return;

      try {
        // Save configuration
        configManager.configureProvider(selectedProvider.id, {
          apiKey: apiKey || undefined,
          model: modelId,
          baseUrl: baseUrl || undefined,
        });

        // Set as active provider
        configManager.setActiveProvider(selectedProvider.id);

        setStep('success');

        // Auto-close after a delay to let user read the success message
        autoCloseTimeoutRef.current = setTimeout(() => {
          onClose();
        }, 3000);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      }
    },
    [selectedProvider, apiKey, baseUrl, configManager, onClose],
  );

  // Get configured providers for showing status
  const configuredProviderIds = configManager.getConfiguredProviderIds();
  const activeProviderId = configManager.getActiveProviderId();

  // Render based on current step
  if (step === 'success') {
    return (
      <Box
        borderStyle="round"
        borderColor={theme.status.success}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold color={theme.status.success}>
          ✓ Configuration Saved
        </Text>
        <Box marginTop={1}>
          <Text color={theme.text.primary}>
            Provider: {selectedProvider?.icon} {selectedProvider?.name}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            The configuration has been saved to ~/.gemini/config.json
          </Text>
        </Box>
      </Box>
    );
  }

  if (step === 'provider') {
    return (
      <Box
        borderStyle="round"
        borderColor={theme.border.focused}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold color={theme.text.primary}>
          Configure LLM Provider
        </Text>
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            Select a provider to configure. Configured providers are marked with
            ✓
          </Text>
        </Box>
        <Box marginTop={1}>
          <DescriptiveRadioButtonSelect
            items={providerItems.map((item) => ({
              ...item,
              title:
                item.value === activeProviderId
                  ? `${item.title} (active)`
                  : configuredProviderIds.includes(item.value)
                    ? `${item.title} ✓`
                    : item.title,
            }))}
            onSelect={handleProviderSelect}
            showNumbers={true}
            maxItemsToShow={8}
            showScrollArrows={true}
          />
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color={theme.status.error}>{error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>(Press Esc to close)</Text>
        </Box>
      </Box>
    );
  }

  if (step === 'apiKey') {
    return (
      <Box
        borderStyle="round"
        borderColor={theme.border.focused}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold color={theme.text.primary}>
          {selectedProvider?.icon} {selectedProvider?.name} - Enter API Key
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.primary}>
            Enter your API key for {selectedProvider?.name}.
          </Text>
          {selectedProvider?.apiKeyUrl && (
            <Text color={theme.text.secondary}>
              Get your API key from:{' '}
              <Text color={theme.text.link}>{selectedProvider.apiKeyUrl}</Text>
            </Text>
          )}
        </Box>
        <Box marginTop={1} flexDirection="row">
          <Box
            borderStyle="round"
            borderColor={theme.border.default}
            paddingX={1}
            flexGrow={1}
          >
            <TextInput
              buffer={apiKeyBuffer}
              onSubmit={handleApiKeySubmit}
              onCancel={() => {
                setStep('provider');
                setError(null);
              }}
              placeholder={
                selectedProvider?.apiKeyPlaceholder || 'Paste your API key here'
              }
            />
          </Box>
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color={theme.status.error}>{error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            (Press Enter to continue, Esc to go back)
          </Text>
        </Box>
      </Box>
    );
  }

  if (step === 'baseUrl') {
    return (
      <Box
        borderStyle="round"
        borderColor={theme.border.focused}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold color={theme.text.primary}>
          {selectedProvider?.icon} {selectedProvider?.name} - Enter Base URL
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.primary}>
            Enter the base URL for your OpenAI-compatible API endpoint.
          </Text>
          <Text color={theme.text.secondary}>
            Example: https://api.example.com/v1
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="row">
          <Box
            borderStyle="round"
            borderColor={theme.border.default}
            paddingX={1}
            flexGrow={1}
          >
            <TextInput
              buffer={baseUrlBuffer}
              onSubmit={handleBaseUrlSubmit}
              onCancel={() => {
                if (selectedProvider?.requiresApiKey) {
                  setStep('apiKey');
                } else {
                  setStep('provider');
                }
                setError(null);
              }}
              placeholder="https://api.example.com/v1"
            />
          </Box>
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color={theme.status.error}>{error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            (Press Enter to continue, Esc to go back)
          </Text>
        </Box>
      </Box>
    );
  }

  if (step === 'model') {
    if (isLoading) {
      return (
        <Box
          borderStyle="round"
          borderColor={theme.border.focused}
          flexDirection="column"
          padding={1}
          width="100%"
        >
          <Text bold color={theme.text.primary}>
            {selectedProvider?.icon} {selectedProvider?.name} - Select Model
          </Text>
          <Box marginTop={1}>
            <Text color={theme.text.primary}>
              <Spinner type="dots" /> Fetching available models...
            </Text>
          </Box>
        </Box>
      );
    }

    return (
      <Box
        borderStyle="round"
        borderColor={theme.border.focused}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold color={theme.text.primary}>
          {selectedProvider?.icon} {selectedProvider?.name} - Select Model
        </Text>
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            Choose a model to use (found {models.length} models)
          </Text>
        </Box>
        <Box marginTop={1}>
          <RadioButtonSelect
            items={modelItems}
            onSelect={handleModelSelect}
            showNumbers={true}
            maxItemsToShow={10}
            showScrollArrows={true}
          />
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color={theme.status.error}>{error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            (Press Enter to select, Esc to go back)
          </Text>
        </Box>
      </Box>
    );
  }

  return null;
}
