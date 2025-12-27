/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import type {
  CommandContext,
  SlashCommand,
  OpenCustomDialogActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { MessageType } from '../types.js';
import { ProviderConfigDialog } from '../components/ProviderConfigDialog.js';
import {
  getConfigManager,
  getAllProviderIds,
  getProviderById,
} from '@google/gemini-cli-core';

/**
 * /provider list - List all configured providers
 */
const providerListCommand: SlashCommand = {
  name: 'list',
  description: 'List all configured providers',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: (context: CommandContext) => {
    const configManager = getConfigManager();
    const configuredProviders = configManager.getAllProviders();
    const activeId = configManager.getActiveProviderId();

    if (configuredProviders.length === 0) {
      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: 'No providers configured. Use /provider to configure one.',
        },
        Date.now(),
      );
      return;
    }

    const lines = ['**Configured Providers:**', ''];

    for (const provider of configuredProviders) {
      const providerDef = getProviderById(provider.id);
      const icon = providerDef?.icon || '📦';
      const isActive = provider.id === activeId ? ' (active)' : '';
      const hasKey = provider.apiKey ? ' ✓' : '';
      lines.push(`${icon} **${provider.name}**${isActive}${hasKey}`);
      lines.push(`   Model: ${provider.model}`);
      if (provider.baseUrl) {
        lines.push(`   URL: ${provider.baseUrl}`);
      }
      lines.push('');
    }

    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: lines.join('\n'),
      },
      Date.now(),
    );
  },
};

/**
 * /provider switch <id> - Switch to a configured provider
 */
const providerSwitchCommand: SlashCommand = {
  name: 'switch',
  description: 'Switch to a configured provider',
  kind: CommandKind.BUILT_IN,
  action: (context: CommandContext, args: string) => {
    const providerId = args.trim();
    if (!providerId) {
      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: 'Usage: /provider switch <provider-id>',
        },
        Date.now(),
      );
      return;
    }

    const configManager = getConfigManager();

    try {
      configManager.setActiveProvider(providerId);
      const provider = configManager.getProvider(providerId);
      const providerDef = getProviderById(providerId);

      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: `Switched to ${providerDef?.icon || ''} **${provider?.name || providerId}** (${provider?.model})`,
        },
        Date.now(),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: `Error: ${message}`,
        },
        Date.now(),
      );
    }
  },
  completion: (_context: CommandContext, partialArg: string) => {
    const configManager = getConfigManager();
    return configManager
      .getConfiguredProviderIds()
      .filter((id) => id.toLowerCase().startsWith(partialArg.toLowerCase()));
  },
};

/**
 * /provider remove <id> - Remove a configured provider
 */
const providerRemoveCommand: SlashCommand = {
  name: 'remove',
  description: 'Remove a configured provider',
  kind: CommandKind.BUILT_IN,
  action: (context: CommandContext, args: string) => {
    const providerId = args.trim();
    if (!providerId) {
      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: 'Usage: /provider remove <provider-id>',
        },
        Date.now(),
      );
      return;
    }

    const configManager = getConfigManager();

    try {
      configManager.removeProvider(providerId);
      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: `Removed provider: ${providerId}`,
        },
        Date.now(),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: `Error: ${message}`,
        },
        Date.now(),
      );
    }
  },
  completion: (_context: CommandContext, partialArg: string) => {
    const configManager = getConfigManager();
    return configManager
      .getConfiguredProviderIds()
      .filter((id) => id.toLowerCase().startsWith(partialArg.toLowerCase()));
  },
};

/**
 * /provider help - Show help for provider commands
 */
const providerHelpCommand: SlashCommand = {
  name: 'help',
  description: 'Show help for provider commands',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: (context: CommandContext) => {
    const lines = [
      '**Provider Commands:**',
      '',
      '`/provider` - Open interactive provider configuration dialog',
      '`/provider <id>` - Configure a specific provider (e.g., `/provider openai`)',
      '`/provider list` - List all configured providers',
      '`/provider status` - Show current active provider status',
      '`/provider switch <id>` - Switch to a different configured provider',
      '`/provider remove <id>` - Remove a configured provider',
      '`/provider help` - Show this help message',
      '',
      '**Available Providers:**',
      '  gemini, openrouter, openai, anthropic, groq, together,',
      '  mistral, deepseek, zai, ollama, lmstudio, custom',
      '',
      '**Examples:**',
      '  `/provider openai` - Configure OpenAI',
      '  `/provider switch anthropic` - Switch to Anthropic',
      '  `/provider list` - See all configured providers',
    ];

    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: lines.join('\n'),
      },
      Date.now(),
    );
  },
};

/**
 * /provider status - Show current provider status
 */
const providerStatusCommand: SlashCommand = {
  name: 'status',
  description: 'Show current provider status',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: (context: CommandContext) => {
    const configManager = getConfigManager();
    const activeProvider = configManager.getActiveProvider();
    const providerDef = getProviderById(configManager.getActiveProviderId());

    if (!activeProvider) {
      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: 'No active provider configured. Use /provider to set one up.',
        },
        Date.now(),
      );
      return;
    }

    const lines = [
      '**Current Provider Status:**',
      '',
      `Provider: ${providerDef?.icon || ''} **${activeProvider.name}**`,
      `Model: ${activeProvider.model}`,
      `API Key: ${activeProvider.apiKey ? '✓ Configured' : '✗ Not set'}`,
    ];

    if (activeProvider.baseUrl) {
      lines.push(`Base URL: ${activeProvider.baseUrl}`);
    }

    if (activeProvider.lastUsed) {
      lines.push(
        `Last Used: ${new Date(activeProvider.lastUsed).toLocaleString()}`,
      );
    }

    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: lines.join('\n'),
      },
      Date.now(),
    );
  },
};

/**
 * Factory function to create the close handler for the provider dialog
 */
function createProviderDialog(
  removeComponent: () => void,
  initialProviderId?: string,
): React.ReactNode {
  return (
    <ProviderConfigDialog
      onClose={removeComponent}
      initialProviderId={initialProviderId}
    />
  );
}

/**
 * Main /provider command - Opens the interactive configuration dialog
 */
export const providerCommand: SlashCommand = {
  name: 'provider',
  altNames: ['config'],
  description: 'Configure LLM providers (API keys, models)',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  subCommands: [
    providerListCommand,
    providerSwitchCommand,
    providerRemoveCommand,
    providerStatusCommand,
    providerHelpCommand,
  ],
  action: (
    context: CommandContext,
    args: string,
  ): OpenCustomDialogActionReturn => {
    const trimmedArgs = args.trim();
    let initialProviderId: string | undefined;

    // Check if a provider ID was passed as an argument
    if (trimmedArgs) {
      const allProviderIds = getAllProviderIds();
      if (allProviderIds.includes(trimmedArgs)) {
        initialProviderId = trimmedArgs;
      }
    }

    return {
      type: 'custom_dialog',
      component: createProviderDialog(
        context.ui.removeComponent,
        initialProviderId,
      ),
    };
  },
  completion: (_context: CommandContext, partialArg: string) => {
    // Complete with available provider IDs
    const allProviderIds = getAllProviderIds();
    return allProviderIds.filter((id) =>
      id.toLowerCase().startsWith(partialArg.toLowerCase()),
    );
  },
};
