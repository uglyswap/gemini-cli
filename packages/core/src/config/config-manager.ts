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
import * as crypto from 'node:crypto';
import { getProviderById } from './provider-registry.js';

/**
 * Generate a unique temporary file path
 */
function getTempFilePath(basePath: string): string {
  const dir = path.dirname(basePath);
  const randomSuffix = crypto.randomBytes(8).toString('hex');
  return path.join(dir, `.config.tmp.${randomSuffix}`);
}

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
 * Note: activeProvider is empty string until a provider is configured
 * This prevents inconsistent state where activeProvider points to non-existent provider
 */
const DEFAULT_CONFIG: GeminiConfig = {
  version: CURRENT_CONFIG_VERSION,
  activeProvider: '',
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
 * Current config version
 */
const CURRENT_CONFIG_VERSION = '1.1';

/**
 * Migrate configuration from older versions
 */
function migrateConfig(config: GeminiConfig): GeminiConfig {
  const version = config.version || '1.0';

  // Migration from 1.0 to 1.1
  if (version === '1.0') {
    // Fix: If activeProvider points to a non-existent provider, clear it
    if (config.activeProvider && !config.providers[config.activeProvider]) {
      config.activeProvider = '';
    }
    config.version = '1.1';
  }

  // Add future migrations here in sequence
  // if (config.version === '1.1') { ... config.version = '1.2'; }

  return config;
}

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

    // Validate non-empty strings for required fields
    const apiKey = options.apiKey?.trim();
    const model = options.model?.trim();
    const baseUrl = options.baseUrl?.trim();

    // Model is required and cannot be empty
    if (model !== undefined && !model) {
      throw new Error('Model cannot be empty');
    }

    const existing = this.config.providers[providerId] || {
      id: providerId,
      name: providerDef.name,
      model: providerDef.defaultModel,
    };

    this.config.providers[providerId] = {
      ...existing,
      // Only set if non-empty string (empty string treated as undefined/remove)
      ...(apiKey ? { apiKey } : options.apiKey === '' ? {} : {}),
      ...(model ? { model } : {}),
      ...(baseUrl ? { baseUrl } : options.baseUrl === '' ? {} : {}),
      ...(options.headers !== undefined && { headers: options.headers }),
      lastUsed: new Date().toISOString(),
    };

    // Clean up undefined/empty values
    if (apiKey !== undefined && !apiKey) {
      delete this.config.providers[providerId].apiKey;
    }
    if (baseUrl !== undefined && !baseUrl) {
      delete this.config.providers[providerId].baseUrl;
    }

    this.saveConfig();
  }

  /**
   * Remove a provider configuration
   */
  removeProvider(providerId: string): void {
    if (this.config.activeProvider === providerId) {
      throw new Error('Cannot remove the active provider');
    }
    if (!this.config.providers[providerId]) {
      throw new Error(`Provider "${providerId}" is not configured`);
    }
    // Prevent removing if it would leave no providers
    const providerCount = Object.keys(this.config.providers).length;
    if (providerCount <= 1) {
      throw new Error('Cannot remove the last configured provider');
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
        let config: GeminiConfig = {
          ...DEFAULT_CONFIG,
          ...parsed,
          providers: parsed.providers || {},
          modelCache: parsed.modelCache || {},
        };

        // Apply migrations if needed
        const originalVersion = config.version;
        config = migrateConfig(config);

        // Save if migration was applied
        if (config.version !== originalVersion) {
          // Defer save to avoid constructor side effects
          setImmediate(() => {
            this.config = config;
            this.saveConfig();
          });
        }

        return config;
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
   * Save configuration to file (atomic write via temp file + rename)
   */
  private saveConfig(): void {
    const tempPath = getTempFilePath(this.configPath);

    try {
      // Ensure directory exists
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
      }

      // Write to temporary file first
      const configData = JSON.stringify(this.config, null, 2);
      fs.writeFileSync(tempPath, configData, {
        encoding: 'utf-8',
        mode: 0o600,
      });

      // Atomic rename (prevents corruption from concurrent writes)
      fs.renameSync(tempPath, this.configPath);
    } catch (error) {
      // Clean up temp file if it exists
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }
      console.error('[ConfigManager] Failed to save config:', error);
      throw error;
    }
  }
}

// Export singleton accessor
export function getConfigManager(): ConfigManager {
  return ConfigManager.getInstance();
}
