/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
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

type ConfigStep = 'provider' | 'apiKey' | 'model' | 'success';

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

  const [step, setStep] = useState<ConfigStep>(
    initialProviderId ? 'apiKey' : 'provider',
  );
  const [selectedProvider, setSelectedProvider] =
    useState<ProviderDefinition | null>(
      initialProviderId ? getProviderById(initialProviderId) || null : null,
    );
  const [apiKey, setApiKey] = useState<string>('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configManager = getConfigManager();
  const modelRegistry = getModelRegistry();

  // Text buffer for API key input
  const buffer = useTextBuffer({
    initialText: '',
    initialCursorOffset: 0,
    viewport: {
      width: viewportWidth,
      height: 4,
    },
    isValidPath: () => false,
    inputFilter: (text) =>
      text.replace(/[^a-zA-Z0-9_\-.:]/g, '').replace(/[\r\n]/g, ''),
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
        } else if (step === 'model') {
          if (selectedProvider?.requiresApiKey) {
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
  const modelItems = useMemo(() => models.map((model) => ({
      value: model.id,
      label: model.name || model.id,
      key: model.id,
    })), [models]);

  // Fetch models when provider is selected
  const fetchModels = useCallback(
    async (providerId: string, key?: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const provider = getProviderById(providerId);
        if (!provider) {
          throw new Error(`Unknown provider: ${providerId}`);
        }

        // Check if local provider is running
        if (provider.isLocal) {
          if (providerId === 'ollama') {
            const isRunning = await modelRegistry.isOllamaRunning(
              provider.defaultBaseUrl,
            );
            if (!isRunning) {
              throw new Error(
                'Ollama is not running. Start it with: ollama serve',
              );
            }
          } else if (providerId === 'lmstudio') {
            const isRunning = await modelRegistry.isLMStudioRunning(
              provider.defaultBaseUrl,
            );
            if (!isRunning) {
              throw new Error(
                'LM Studio is not running. Start it and enable the local server.',
              );
            }
          }
        }

        const result = await modelRegistry.fetchModels(providerId, {
          apiKey: key,
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
        buffer.setText(existingConfig.apiKey);
      }

      if (provider.requiresApiKey) {
        setStep('apiKey');
      } else {
        // Local providers don't need API key, go straight to models
        void fetchModels(providerId);
      }
    },
    [configManager, fetchModels, buffer],
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
      void fetchModels(selectedProvider.id, trimmedKey);
    },
    [selectedProvider, fetchModels],
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
        });

        // Set as active provider
        configManager.setActiveProvider(selectedProvider.id);

        setStep('success');

        // Auto-close after a short delay
        setTimeout(() => {
          onClose();
        }, 1500);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      }
    },
    [selectedProvider, apiKey, configManager, onClose],
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
              buffer={buffer}
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
