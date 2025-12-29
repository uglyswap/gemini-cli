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
import type { ToolRegistry } from '../../tools/tool-registry.js';

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
  private readonly toolRegistry: ToolRegistry | undefined;
  private readonly eventCallbacks: AgentSessionEventCallback[] = [];

  private state: AgentSessionState;
  private isActive = true;

  // Track files modified during execution
  private modifiedFiles: Set<string> = new Set();
  private createdFiles: Set<string> = new Set();
  private deletedFiles: Set<string> = new Set();

  constructor(
    private readonly config: Config,
    private readonly contentGenerator: ContentGenerator,
    sessionConfig: AgentSessionConfig,
  ) {
    this.sessionId = randomUUID();
    this.agent = sessionConfig.agent;
    this.workingDirectory = sessionConfig.workingDirectory;
    this.tools = sessionConfig.tools || this.buildAgentTools();
    this.toolRegistry = sessionConfig.toolRegistry;

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
   * Implements a full tool execution loop
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

    // Reset file tracking for this task
    this.modifiedFiles.clear();
    this.createdFiles.clear();
    this.deletedFiles.clear();

    const allToolCalls: AgentToolCall[] = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;
    let finalText = '';

    try {
      // Use the user-selected model from CLI config
      const selectedModel = this.config.getModel();
      const systemInstruction = this.buildSystemInstruction();

      // Add user message to history
      const userContent: Content = {
        role: 'user',
        parts: [{ text: task }],
      };
      this.history.push(userContent);

      // Maximum iterations to prevent infinite loops
      const MAX_ITERATIONS = 10;
      let iteration = 0;

      while (iteration < MAX_ITERATIONS) {
        iteration++;

        // Check for abort signal
        if (abortSignal?.aborted) {
          throw new Error('Task was aborted');
        }

        // Make API call
        const response = await this.contentGenerator.generateContent(
          {
            model: selectedModel,
            contents: this.history,
            config: {
              systemInstruction,
              tools: this.tools,
              maxOutputTokens: 32768,
              temperature: 0.7,
              abortSignal,
            },
          },
          `agent-${this.agent.id}-${this.sessionId}`,
        );

        // Track token usage
        if (response.usageMetadata) {
          totalPromptTokens += response.usageMetadata.promptTokenCount || 0;
          totalCompletionTokens +=
            response.usageMetadata.candidatesTokenCount || 0;
          totalTokens += response.usageMetadata.totalTokenCount || 0;
        }

        // Extract response content
        const responseContent = response.candidates?.[0]?.content;
        if (responseContent) {
          this.history.push(responseContent);
        }

        // Parse response for text and tool calls
        const { text, toolCalls } = this.parseResponse(responseContent);
        finalText = text;

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          break;
        }

        // Execute tool calls
        const toolResults = await this.executeToolCalls(toolCalls, abortSignal);
        allToolCalls.push(...toolResults);

        // Add tool results to history for the model
        const toolResultContent: Content = {
          role: 'user',
          parts: toolResults.map((tc) => ({
            functionResponse: {
              id: tc.id, // Required for OpenAI-compatible providers (e.g., Anthropic via OpenRouter)
              name: tc.name,
              response: {
                result: tc.success ? tc.result : { error: tc.error },
              },
            },
          })),
        };
        this.history.push(toolResultContent);
      }

      // Update state
      this.state.lastActiveAt = new Date();
      this.state.taskCount++;
      this.state.totalTokens += totalTokens;

      const result: AgentTaskResult = {
        success: true,
        output: finalText,
        toolCalls: allToolCalls,
        modifiedFiles: Array.from(this.modifiedFiles),
        createdFiles: Array.from(this.createdFiles),
        deletedFiles: Array.from(this.deletedFiles),
        durationMs: Date.now() - startTime,
        tokenUsage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens,
        },
      };

      this.emit({ type: 'task_completed', sessionId: this.sessionId, result });
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const result: AgentTaskResult = {
        success: false,
        output: finalText,
        error: errorMessage,
        toolCalls: allToolCalls,
        modifiedFiles: Array.from(this.modifiedFiles),
        createdFiles: Array.from(this.createdFiles),
        deletedFiles: Array.from(this.deletedFiles),
        durationMs: Date.now() - startTime,
      };

      this.emit({ type: 'task_completed', sessionId: this.sessionId, result });
      return result;
    }
  }

  /**
   * Execute tool calls using the tool registry
   */
  private async executeToolCalls(
    toolCalls: AgentToolCall[],
    abortSignal?: AbortSignal,
  ): Promise<AgentToolCall[]> {
    const results: AgentToolCall[] = [];

    for (const toolCall of toolCalls) {
      this.emit({ type: 'tool_called', sessionId: this.sessionId, toolCall });

      if (!this.toolRegistry) {
        // No tool registry - can't execute tools
        results.push({
          ...toolCall,
          success: false,
          error: 'No tool registry available for execution',
        });
        continue;
      }

      const tool = this.toolRegistry.getTool(toolCall.name);
      if (!tool) {
        results.push({
          ...toolCall,
          success: false,
          error: `Tool '${toolCall.name}' not found in registry`,
        });
        continue;
      }

      try {
        // Create tool invocation using build() method
        const invocation = tool.build(toolCall.args as object);

        // Execute the tool
        const signal = abortSignal || new AbortController().signal;
        const toolResult = await invocation.execute(signal);

        // Track file modifications based on tool type
        this.trackFileModifications(toolCall.name, toolCall.args, toolResult);

        results.push({
          ...toolCall,
          success: !toolResult.error,
          result: toolResult.llmContent,
          error: toolResult.error?.message,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        results.push({
          ...toolCall,
          success: false,
          error: errorMessage,
        });
      }
    }

    return results;
  }

  /**
   * Track file modifications based on tool execution
   */
  private trackFileModifications(
    toolName: string,
    args: Record<string, unknown>,
    _result: unknown,
  ): void {
    const filePath = (args['path'] || args['file_path'] || args['filePath']) as
      | string
      | undefined;

    if (!filePath) return;

    // Map tool names to file operations
    const writeTools = [
      'WriteFile',
      'write_file',
      'writeFile',
      'EditFile',
      'edit_file',
      'editFile',
    ];
    const createTools = ['CreateFile', 'create_file', 'createFile'];
    const deleteTools = [
      'DeleteFile',
      'delete_file',
      'deleteFile',
      'RemoveFile',
      'remove_file',
    ];

    if (writeTools.some((t) => toolName.includes(t))) {
      this.modifiedFiles.add(filePath);
    } else if (createTools.some((t) => toolName.includes(t))) {
      this.createdFiles.add(filePath);
    } else if (deleteTools.some((t) => toolName.includes(t))) {
      this.deletedFiles.add(filePath);
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

GUIDELINES:
- Your primary expertise is in your domain, but you should still try to help with related tasks
- Be thorough and follow best practices
- Report any issues or concerns clearly
- If a task is completely outside your capabilities, explain what you CAN help with instead
- Always provide useful, actionable responses - never just say "this is outside my domain"
- When asked general questions, answer them helpfully based on your knowledge
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
        // Generate a unique ID if the model doesn't provide one (OpenAI-compatible providers require this)
        const toolCallId =
          part.functionCall.id ||
          `call_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const toolCall: AgentToolCall = {
          id: toolCallId,
          name: part.functionCall.name || 'unknown',
          args: safeArgs(part.functionCall.args),
          success: false, // Will be set to true after execution
        };
        toolCalls.push(toolCall);
        // Don't emit here - we emit in executeToolCalls after execution
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
