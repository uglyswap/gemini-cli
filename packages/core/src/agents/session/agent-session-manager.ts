/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tool } from '@google/genai';
import { AgentSession } from './agent-session.js';
import type {
  AgentSessionConfig,
  AgentTaskResult,
  AgentSessionState,
  AgentSessionEvent,
  AgentSessionEventCallback,
} from './types.js';
import type { SpecializedAgent } from '../specialized/types.js';
import type { Config } from '../../config/config.js';
import type { ContentGenerator } from '../../core/contentGenerator.js';

/**
 * Configuration for the AgentSessionManager
 */
export interface AgentSessionManagerConfig {
  /** Maximum concurrent sessions */
  maxConcurrentSessions?: number;
  /** Session timeout in milliseconds */
  sessionTimeoutMs?: number;
  /** Whether to reuse sessions for the same agent */
  reuseAgentSessions?: boolean;
  /** Default tools available to all agents */
  defaultTools?: Tool[];
  /** Working directory */
  workingDirectory: string;
}

/**
 * Manages multiple isolated agent sessions.
 * Ensures each agent operates in its own context without cross-contamination.
 */
export class AgentSessionManager {
  private readonly sessions: Map<string, AgentSession> = new Map();
  private readonly agentToSession: Map<string, string> = new Map();
  private readonly eventCallbacks: AgentSessionEventCallback[] = [];
  private readonly maxConcurrentSessions: number;
  private readonly sessionTimeoutMs: number;
  private readonly reuseAgentSessions: boolean;
  private readonly defaultTools: Tool[];
  private readonly workingDirectory: string;
  // Locking mechanism to prevent race conditions
  private readonly sessionCreationLocks: Map<string, Promise<AgentSession>> =
    new Map();

  constructor(
    private readonly config: Config,
    private readonly contentGenerator: ContentGenerator,
    managerConfig: AgentSessionManagerConfig,
  ) {
    this.maxConcurrentSessions = managerConfig.maxConcurrentSessions || 10;
    this.sessionTimeoutMs = managerConfig.sessionTimeoutMs || 30 * 60 * 1000; // 30 minutes
    this.reuseAgentSessions = managerConfig.reuseAgentSessions ?? true;
    this.defaultTools = managerConfig.defaultTools || [];
    this.workingDirectory = managerConfig.workingDirectory;
  }

  /**
   * Get or create a session for an agent (with locking to prevent race conditions)
   */
  async getOrCreateSession(agent: SpecializedAgent): Promise<AgentSession> {
    // Check if there's an ongoing creation for this agent
    const existingLock = this.sessionCreationLocks.get(agent.id);
    if (existingLock) {
      return existingLock;
    }

    // Check if we should reuse existing session
    if (this.reuseAgentSessions) {
      const existingSessionId = this.agentToSession.get(agent.id);
      if (existingSessionId) {
        const session = this.sessions.get(existingSessionId);
        if (session && session.getState().isActive) {
          return session;
        }
        // Clean up stale reference
        this.agentToSession.delete(agent.id);
        this.sessions.delete(existingSessionId);
      }
    }

    // Create a promise that will resolve with the new session
    const creationPromise = this.createSessionInternal(agent);
    this.sessionCreationLocks.set(agent.id, creationPromise);

    try {
      const session = await creationPromise;
      return session;
    } finally {
      this.sessionCreationLocks.delete(agent.id);
    }
  }

  /**
   * Internal method to create a session
   */
  private async createSessionInternal(
    agent: SpecializedAgent,
  ): Promise<AgentSession> {
    // Check session limit
    if (this.sessions.size >= this.maxConcurrentSessions) {
      await this.cleanupOldestSession();
    }

    // Create new session
    const sessionConfig: AgentSessionConfig = {
      agent,
      workingDirectory: this.workingDirectory,
      tools: this.defaultTools,
    };

    const session = new AgentSession(
      this.config,
      this.contentGenerator,
      sessionConfig,
    );

    // Subscribe to session events
    session.onEvent((event) => this.handleSessionEvent(event));

    const sessionId = session.getState().sessionId;
    this.sessions.set(sessionId, session);
    this.agentToSession.set(agent.id, sessionId);

    return session;
  }

  /**
   * Execute a task with a specific agent
   */
  async executeAgentTask(
    agent: SpecializedAgent,
    task: string,
    abortSignal?: AbortSignal,
  ): Promise<AgentTaskResult> {
    const session = await this.getOrCreateSession(agent);
    return session.executeTask(task, abortSignal);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): AgentSessionState[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.getState().isActive)
      .map((session) => session.getState());
  }

  /**
   * Get a specific session by ID
   */
  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get session for a specific agent
   */
  getAgentSession(agentId: string): AgentSession | undefined {
    const sessionId = this.agentToSession.get(agentId);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  /**
   * Close a specific session
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      const agentId = session.getAgent().id;
      await session.close();
      this.sessions.delete(sessionId);
      this.agentToSession.delete(agentId);
    }
  }

  /**
   * Close all sessions for an agent
   */
  async closeAgentSessions(agentId: string): Promise<void> {
    const sessionId = this.agentToSession.get(agentId);
    if (sessionId) {
      await this.closeSession(sessionId);
    }
  }

  /**
   * Close all sessions
   */
  async closeAllSessions(): Promise<void> {
    const closePromises = Array.from(this.sessions.values()).map((session) =>
      session.close(),
    );
    await Promise.all(closePromises);
    this.sessions.clear();
    this.agentToSession.clear();
  }

  /**
   * Subscribe to session events from all managed sessions
   */
  onEvent(callback: AgentSessionEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  /**
   * Get statistics about session usage
   */
  getStats(): SessionManagerStats {
    const sessions = Array.from(this.sessions.values());
    const activeSessions = sessions.filter((s) => s.getState().isActive);

    return {
      totalSessions: sessions.length,
      activeSessions: activeSessions.length,
      totalTasks: sessions.reduce((sum, s) => sum + s.getState().taskCount, 0),
      totalTokens: sessions.reduce(
        (sum, s) => sum + s.getState().totalTokens,
        0,
      ),
      agentBreakdown: this.getAgentBreakdown(),
    };
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      const state = session.getState();
      const lastActive = state.lastActiveAt.getTime();

      if (now - lastActive > this.sessionTimeoutMs) {
        // Fire-and-forget cleanup - we don't need to await individual session closures
        void this.closeSession(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Handle events from individual sessions
   */
  private handleSessionEvent(event: AgentSessionEvent): void {
    // Forward to all registered callbacks
    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (error) {
        console.error('Error in session manager event callback:', error);
      }
    }
  }

  /**
   * Clean up the oldest inactive session to make room
   */
  private async cleanupOldestSession(): Promise<void> {
    let oldestSession: AgentSession | null = null;
    let oldestTime = Infinity;

    for (const session of this.sessions.values()) {
      const state = session.getState();
      const lastActive = state.lastActiveAt.getTime();

      if (lastActive < oldestTime) {
        oldestTime = lastActive;
        oldestSession = session;
      }
    }

    if (oldestSession) {
      await this.closeSession(oldestSession.getState().sessionId);
    }
  }

  /**
   * Get breakdown of sessions by agent
   */
  private getAgentBreakdown(): Record<string, AgentSessionStats> {
    const breakdown: Record<string, AgentSessionStats> = {};

    for (const session of this.sessions.values()) {
      const state = session.getState();
      const agent = session.getAgent();

      if (!breakdown[agent.id]) {
        breakdown[agent.id] = {
          agentName: agent.name,
          sessionCount: 0,
          taskCount: 0,
          tokenCount: 0,
        };
      }

      breakdown[agent.id].sessionCount++;
      breakdown[agent.id].taskCount += state.taskCount;
      breakdown[agent.id].tokenCount += state.totalTokens;
    }

    return breakdown;
  }
}

/**
 * Statistics for the session manager
 */
export interface SessionManagerStats {
  totalSessions: number;
  activeSessions: number;
  totalTasks: number;
  totalTokens: number;
  agentBreakdown: Record<string, AgentSessionStats>;
}

/**
 * Per-agent session statistics
 */
export interface AgentSessionStats {
  agentName: string;
  sessionCount: number;
  taskCount: number;
  tokenCount: number;
}
