/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Content, Tool } from '@google/genai';
import { randomUUID } from 'node:crypto';
import type {
  AgentSessionConfig,
  AgentTaskResult,
  AgentSessionState,
  AgentToolCall,
  AgentSessionEvent,
  AgentSessionEventCallback,
} from './types.js';
import type { SpecializedAgent } from '../specialized/types.js';
import type { Config } from '../../config/config.js';
import type { ContentGenerator } from '../../core/contentGenerator.js';

/**
 * Safely extract args from a functionCall object.
 * Validates that args is a non-null object and returns it as Record<string, unknown>.
 * @param args - The args from functionCall (can be any type from the API)
 * @returns A validated Record<string, unknown> or empty object
 */
function safeArgs(args: unknown): Record<string, unknown> {
  if (args === null || args === undefined) {
    return {};
  }
  if (typeof args !== 'object') {
    return {};
  }
  // TypeScript now knows args is an object
  return args as Record<string, unknown>;
}

/**
 * Represents an isolated session for a specialized agent.
 * Each agent gets its own context window to prevent cross-contamination.
 */
export class AgentSession {
  private readonly sessionId: string;
  private readonly agent: SpecializedAgent;
  private readonly workingDirectory: string;
  private readonly history: Content[] = [];
  private readonly tools: Tool[];
  private readonly eventCallbacks: AgentSessionEventCallback[] = [];

  private state: AgentSessionState;
  private isActive = true;

  constructor(
    private readonly config: Config,
    private readonly contentGenerator: ContentGenerator,
    sessionConfig: AgentSessionConfig,
  ) {
    this.sessionId = randomUUID();
    this.agent = sessionConfig.agent;
    this.workingDirectory = sessionConfig.workingDirectory;
    this.tools = sessionConfig.tools || this.buildAgentTools();

    // Initialize with any provided context
    if (sessionConfig.initialContext) {
      this.history.push(...sessionConfig.initialContext);
    }

    this.state = {
      sessionId: this.sessionId,
      agentId: this.agent.id,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      taskCount: 0,
      totalTokens: 0,
      isActive: true,
    };

    this.emit({
      type: 'session_created',
      sessionId: this.sessionId,
      agentId: this.agent.id,
    });
  }

  /**
   * Execute a task within this agent's isolated context
   */
  async executeTask(
    task: string,
    abortSignal?: AbortSignal,
  ): Promise<AgentTaskResult> {
    if (!this.isActive) {
      return {
        success: false,
        output: '',
        error: 'Session is closed',
        durationMs: 0,
      };
    }

    const startTime = Date.now();
    this.emit({ type: 'task_started', sessionId: this.sessionId, task });

    try {
      // Use the user-selected model from CLI config (best quality, no tier-based selection)
      const selectedModel = this.config.getModel();

      // Build the system instruction with agent's specialized prompt
      const systemInstruction = this.buildSystemInstruction();

      // Add user message to history
      const userContent: Content = {
        role: 'user',
        parts: [{ text: task }],
      };
      this.history.push(userContent);

      // Make the API call with user's selected model
      const response = await this.contentGenerator.generateContent(
        {
          model: selectedModel,
          contents: this.history,
          config: {
            systemInstruction,
            tools: this.tools,
            maxOutputTokens: 32768, // Max quality output
            temperature: 0.7,
            abortSignal,
          },
        },
        `agent-${this.agent.id}-${this.sessionId}`,
      );

      // Extract response content
      const responseContent = response.candidates?.[0]?.content;
      if (responseContent) {
        this.history.push(responseContent);
      }

      // Extract text and tool calls from response
      const { text, toolCalls } = this.parseResponse(responseContent);

      // Update state
      this.state.lastActiveAt = new Date();
      this.state.taskCount++;
      if (response.usageMetadata) {
        this.state.totalTokens += response.usageMetadata.totalTokenCount || 0;
      }

      const result: AgentTaskResult = {
        success: true,
        output: text,
        toolCalls,
        durationMs: Date.now() - startTime,
        tokenUsage: response.usageMetadata
          ? {
              promptTokens: response.usageMetadata.promptTokenCount || 0,
              completionTokens:
                response.usageMetadata.candidatesTokenCount || 0,
              totalTokens: response.usageMetadata.totalTokenCount || 0,
            }
          : undefined,
      };

      this.emit({ type: 'task_completed', sessionId: this.sessionId, result });
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const result: AgentTaskResult = {
        success: false,
        output: '',
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };

      this.emit({ type: 'task_completed', sessionId: this.sessionId, result });
      return result;
    }
  }

  /**
   * Get the current session state
   */
  getState(): AgentSessionState {
    return { ...this.state };
  }

  /**
   * Get the session's conversation history
   */
  getHistory(): Content[] {
    return [...this.history];
  }

  /**
   * Get the agent associated with this session
   */
  getAgent(): SpecializedAgent {
    return this.agent;
  }

  /**
   * Subscribe to session events
   * @returns Unsubscribe function to remove the callback
   */
  onEvent(callback: AgentSessionEventCallback): () => void {
    this.eventCallbacks.push(callback);
    // Return unsubscribe function
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index !== -1) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Close the session and release resources
   */
  async close(): Promise<void> {
    if (!this.isActive) {
      return; // Already closed
    }
    this.isActive = false;
    this.state.isActive = false;
    this.emit({ type: 'session_closed', sessionId: this.sessionId });
    // Clear all event callbacks to prevent memory leaks
    this.eventCallbacks.length = 0;
    // Clear history to release memory
    this.history.length = 0;
  }

  /**
   * Build the system instruction combining base context with agent's specialized prompt
   */
  private buildSystemInstruction(): string {
    const baseContext = `
You are ${this.agent.name}, a specialized AI agent.
Working Directory: ${this.workingDirectory}
Session ID: ${this.sessionId}

Your expertise and responsibilities:
${this.agent.systemPrompt}

Quality Expectations:
${this.agent.qualityChecks.map((check) => `- ${check}`).join('\n')}

IMPORTANT:
- Focus ONLY on tasks within your domain of expertise
- Be thorough and follow best practices
- Report any issues or concerns clearly
- Do not attempt tasks outside your specialization
`.trim();

    return baseContext;
  }

  /**
   * Build tools available to this agent based on its configuration.
   *
   * This method constructs the set of tools that this agent can use during execution.
   * Currently returns an empty array as tools are injected externally from the main CLI.
   *
   * @returns An array of Tool objects configured for this agent's capabilities.
   *          The tools are filtered based on the agent's `tools` configuration property.
   *
   * @remarks
   * - In the current implementation, tools are passed via sessionConfig.tools
   * - Future implementations may dynamically filter tools based on agent.tools list
   * - Tool access may be restricted based on agent trust level
   *
   * @example
   * ```typescript
   * // Tools are typically injected during session creation:
   * const session = new AgentSession(config, generator, {
   *   agent: codeReviewAgent,
   *   tools: [readFileTool, writeFileTool],
   *   workingDirectory: '/project'
   * });
   * ```
   */
  private buildAgentTools(): Tool[] {
    // For now, return empty array - tools will be injected from the main CLI
    // In a full implementation, this would filter/configure tools based on agent.tools
    return [];
  }

  /**
   * Parse the model response to extract text and tool calls
   */
  private parseResponse(content?: Content): {
    text: string;
    toolCalls: AgentToolCall[];
  } {
    if (!content?.parts) {
      return { text: '', toolCalls: [] };
    }

    const textParts: string[] = [];
    const toolCalls: AgentToolCall[] = [];

    for (const part of content.parts) {
      if (part.text) {
        textParts.push(part.text);
      }
      if (part.functionCall) {
        const toolCall: AgentToolCall = {
          name: part.functionCall.name || 'unknown',
          args: safeArgs(part.functionCall.args),
          success: true, // Will be updated when executed
        };
        toolCalls.push(toolCall);
        this.emit({ type: 'tool_called', sessionId: this.sessionId, toolCall });
      }
    }

    return {
      text: textParts.join('\n'),
      toolCalls,
    };
  }

  /**
   * Emit an event to all registered callbacks
   */
  private emit(event: AgentSessionEvent): void {
    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error('Error in session event callback:', error);
      }
    }
  }
}
