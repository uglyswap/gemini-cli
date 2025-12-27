/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Config Manager
 * Handles persistent configuration storage for providers, models, and API keys
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getProviderById } from './provider-registry.js';

/**
 * Provider configuration stored in config file
 */
export interface ProviderConfig {
  /** Provider ID */
  id: string;
  /** Display name (from registry) */
  name: string;
  /** API key (stored in plain text) */
  apiKey?: string;
  /** Selected model */
  model: string;
  /** Base URL (can override default) */
  baseUrl?: string;
  /** Custom headers */
  headers?: Record<string, string>;
  /** Last used timestamp */
  lastUsed?: string;
}

/**
 * Cached model list for a provider
 */
export interface ModelCache {
  /** List of available models */
  models: string[];
  /** When the cache was fetched */
  fetchedAt: string;
  /** TTL in hours */
  ttlHours: number;
}

/**
 * Complete configuration file structure
 */
export interface GeminiConfig {
  /** Config file version */
  version: string;
  /** Currently active provider ID */
  activeProvider: string;
  /** Configured providers */
  providers: Record<string, ProviderConfig>;
  /** Model cache per provider */
  modelCache: Record<string, ModelCache>;
  /** User preferences */
  preferences?: {
    /** Show setup wizard on first run */
    showSetupWizard?: boolean;
    /** Theme for interactive prompts */
    theme?: 'default' | 'minimal';
  };
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: GeminiConfig = {
  version: '1.0',
  activeProvider: 'gemini',
  providers: {},
  modelCache: {},
  preferences: {
    showSetupWizard: true,
    theme: 'default',
  },
};

/**
 * Model cache TTL in hours
 */
const MODEL_CACHE_TTL_HOURS = 24;

/**
 * Config Manager class
 * Singleton pattern for consistent config access
 */
export class ConfigManager {
  private static instance: ConfigManager | null = null;
  private config: GeminiConfig;
  private readonly configPath: string;
  private readonly configDir: string;

  private constructor() {
    this.configDir = path.join(os.homedir(), '.gemini');
    this.configPath = path.join(this.configDir, 'config.json');
    this.config = this.loadConfig();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  static resetInstance(): void {
    ConfigManager.instance = null;
  }

  /**
   * Get the config directory path
   */
  getConfigDir(): string {
    return this.configDir;
  }

  /**
   * Get the config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Check if config file exists
   */
  configExists(): boolean {
    return fs.existsSync(this.configPath);
  }

  /**
   * Check if any provider is configured
   */
  hasConfiguredProviders(): boolean {
    return Object.keys(this.config.providers).length > 0;
  }

  /**
   * Get the active provider configuration
   */
  getActiveProvider(): ProviderConfig | undefined {
    return this.config.providers[this.config.activeProvider];
  }

  /**
   * Get the active provider ID
   */
  getActiveProviderId(): string {
    return this.config.activeProvider;
  }

  /**
   * Get a specific provider configuration
   */
  getProvider(providerId: string): ProviderConfig | undefined {
    return this.config.providers[providerId];
  }

  /**
   * Get all configured providers
   */
  getAllProviders(): ProviderConfig[] {
    return Object.values(this.config.providers);
  }

  /**
   * Get configured provider IDs
   */
  getConfiguredProviderIds(): string[] {
    return Object.keys(this.config.providers);
  }

  /**
   * Set the active provider
   */
  setActiveProvider(providerId: string): void {
    if (!this.config.providers[providerId]) {
      throw new Error(`Provider "${providerId}" is not configured`);
    }
    this.config.activeProvider = providerId;
    this.config.providers[providerId].lastUsed = new Date().toISOString();
    this.saveConfig();
  }

  /**
   * Configure a provider
   */
  configureProvider(
    providerId: string,
    options: {
      apiKey?: string;
      model?: string;
      baseUrl?: string;
      headers?: Record<string, string>;
    },
  ): void {
    const providerDef = getProviderById(providerId);
    if (!providerDef) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const existing = this.config.providers[providerId] || {
      id: providerId,
      name: providerDef.name,
      model: providerDef.defaultModel,
    };

    this.config.providers[providerId] = {
      ...existing,
      ...(options.apiKey !== undefined && { apiKey: options.apiKey }),
      ...(options.model !== undefined && { model: options.model }),
      ...(options.baseUrl !== undefined && { baseUrl: options.baseUrl }),
      ...(options.headers !== undefined && { headers: options.headers }),
      lastUsed: new Date().toISOString(),
    };

    this.saveConfig();
  }

  /**
   * Remove a provider configuration
   */
  removeProvider(providerId: string): void {
    if (this.config.activeProvider === providerId) {
      throw new Error('Cannot remove the active provider');
    }
    delete this.config.providers[providerId];
    delete this.config.modelCache[providerId];
    this.saveConfig();
  }

  /**
   * Get active model
   */
  getActiveModel(): string | undefined {
    const provider = this.getActiveProvider();
    return provider?.model;
  }

  /**
   * Set model for active provider
   */
  setActiveModel(model: string): void {
    const providerId = this.config.activeProvider;
    if (!this.config.providers[providerId]) {
      throw new Error(`Provider "${providerId}" is not configured`);
    }
    this.config.providers[providerId].model = model;
    this.saveConfig();
  }

  /**
   * Get API key for active provider
   */
  getActiveApiKey(): string | undefined {
    return this.getActiveProvider()?.apiKey;
  }

  /**
   * Get base URL for active provider
   */
  getActiveBaseUrl(): string | undefined {
    const provider = this.getActiveProvider();
    if (provider?.baseUrl) {
      return provider.baseUrl;
    }
    const providerDef = getProviderById(this.config.activeProvider);
    return providerDef?.defaultBaseUrl;
  }

  /**
   * Get cached models for a provider
   */
  getCachedModels(providerId: string): string[] | undefined {
    const cache = this.config.modelCache[providerId];
    if (!cache) return undefined;

    // Check if cache is expired
    const fetchedAt = new Date(cache.fetchedAt);
    const now = new Date();
    const hoursSinceFetch =
      (now.getTime() - fetchedAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceFetch > cache.ttlHours) {
      return undefined; // Cache expired
    }

    return cache.models;
  }

  /**
   * Set cached models for a provider
   */
  setCachedModels(providerId: string, models: string[]): void {
    this.config.modelCache[providerId] = {
      models,
      fetchedAt: new Date().toISOString(),
      ttlHours: MODEL_CACHE_TTL_HOURS,
    };
    this.saveConfig();
  }

  /**
   * Clear model cache for a provider
   */
  clearModelCache(providerId?: string): void {
    if (providerId) {
      delete this.config.modelCache[providerId];
    } else {
      this.config.modelCache = {};
    }
    this.saveConfig();
  }

  /**
   * Get user preferences
   */
  getPreferences(): GeminiConfig['preferences'] {
    return this.config.preferences || {};
  }

  /**
   * Update user preferences
   */
  setPreferences(preferences: Partial<GeminiConfig['preferences']>): void {
    this.config.preferences = {
      ...this.config.preferences,
      ...preferences,
    };
    this.saveConfig();
  }

  /**
   * Check if setup wizard should be shown
   */
  shouldShowSetupWizard(): boolean {
    return (
      !this.hasConfiguredProviders() &&
      this.config.preferences?.showSetupWizard !== false
    );
  }

  /**
   * Mark setup wizard as completed
   */
  markSetupComplete(): void {
    this.setPreferences({ showSetupWizard: false });
  }

  /**
   * Export configuration for environment variables
   */
  exportAsEnvVars(): Record<string, string> {
    const provider = this.getActiveProvider();
    const baseUrl = this.getActiveBaseUrl();

    const env: Record<string, string> = {};

    if (provider?.apiKey) {
      env['OPENAI_COMPATIBLE_API_KEY'] = provider.apiKey;
    }
    if (baseUrl) {
      env['OPENAI_COMPATIBLE_BASE_URL'] = baseUrl;
    }
    if (provider?.model) {
      env['OPENAI_COMPATIBLE_MODEL'] = provider.model;
    }

    return env;
  }

  /**
   * Get full configuration (for debugging)
   */
  getFullConfig(): GeminiConfig {
    return { ...this.config };
  }

  /**
   * Reload configuration from disk
   */
  reload(): void {
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from file
   */
  private loadConfig(): GeminiConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(content) as GeminiConfig;
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          providers: parsed.providers || {},
          modelCache: parsed.modelCache || {},
        };
      }
    } catch (error) {
      console.warn(
        '[ConfigManager] Could not load config, using defaults:',
        error,
      );
    }
    return { ...DEFAULT_CONFIG };
  }

  /**
   * Save configuration to file
   */
  private saveConfig(): void {
    try {
      // Ensure directory exists
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }

      // Write config with pretty formatting
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        'utf-8',
      );
    } catch (error) {
      console.error('[ConfigManager] Failed to save config:', error);
      throw error;
    }
  }
}

// Export singleton accessor
export function getConfigManager(): ConfigManager {
  return ConfigManager.getInstance();
}
