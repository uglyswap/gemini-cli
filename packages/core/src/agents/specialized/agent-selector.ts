/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent Selector
 * Implements intelligent agent selection based on task analysis
 */

import type {
  AgentSpecialization,
  AgentSelectionResult,
  TaskComplexity,
} from './types.js';
import { AGENT_REGISTRY, getAgentById } from './agent-registry.js';

/**
 * Configuration for agent selection
 */
export interface AgentSelectorConfig {
  /** Maximum agents to select for a single task */
  maxAgents: number;
  /** Minimum score threshold to include an agent */
  minScoreThreshold: number;
  /** Boost factor for agents in same domain */
  domainBoost: number;
  /** Enable debug logging */
  debug: boolean;
}

const DEFAULT_CONFIG: AgentSelectorConfig = {
  maxAgents: 4,
  minScoreThreshold: 5,
  domainBoost: 1.5,
  debug: false,
};

/**
 * Agent Selector
 * Analyzes tasks and selects appropriate specialized agents
 */
export class AgentSelector {
  private config: AgentSelectorConfig;

  constructor(config: Partial<AgentSelectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Select agents for a given task
   */
  selectAgents(taskDescription: string): AgentSelectionResult {
    const complexity = this.analyzeComplexity(taskDescription);
    const scores = this.scoreAgents(taskDescription);
    const maxAgents = this.getMaxAgentsForComplexity(complexity);

    // Sort by score and filter
    const sortedAgents = Array.from(scores.entries())
      .filter(([_, score]) => score >= this.config.minScoreThreshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxAgents);

    const selectedAgents = sortedAgents
      .map(([id]) => getAgentById(id))
      .filter((agent): agent is AgentSpecialization => agent !== undefined);

    const reasoning = this.generateReasoning(
      taskDescription,
      selectedAgents,
      scores,
      complexity,
    );

    if (this.config.debug) {
      console.log('[AgentSelector] Task:', taskDescription.slice(0, 100));
      console.log('[AgentSelector] Complexity:', complexity);
      console.log(
        '[AgentSelector] Selected:',
        selectedAgents.map((a) => a.id).join(', '),
      );
      console.log('[AgentSelector] Scores:', Object.fromEntries(sortedAgents));
    }

    return {
      agents: selectedAgents,
      complexity,
      scores,
      reasoning,
    };
  }

  /**
   * Analyze task complexity
   */
  analyzeComplexity(taskDescription: string): TaskComplexity {
    const lower = taskDescription.toLowerCase();

    // Complex indicators
    const complexIndicators = [
      'architecture',
      'refactor',
      'migrate',
      'security audit',
      'performance optimization',
      'redesign',
      'rewrite',
      'microservice',
      'distributed',
      'scale',
      'infrastructure',
      'breaking change',
      'major update',
    ];

    // Moderate indicators
    const moderateIndicators = [
      'implement',
      'add',
      'create',
      'update',
      'fix bug',
      'integrate',
      'configure',
      'setup',
      'build',
      'develop',
    ];

    // Simple indicators
    const simpleIndicators = [
      'typo',
      'rename',
      'move',
      'delete',
      'remove',
      'format',
      'lint',
      'comment',
      'documentation',
    ];

    // Check for multiple domains mentioned (increases complexity)
    const domains = [
      'frontend',
      'backend',
      'database',
      'security',
      'devops',
      'test',
    ];
    const mentionedDomains = domains.filter((d) => lower.includes(d)).length;

    // Check for file quantity mentions
    const multiFilePattern =
      /multiple files|across.*files|all.*components|entire.*codebase/i;
    const isMultiFile = multiFilePattern.test(taskDescription);

    // Calculate complexity score
    let complexityScore = 0;

    if (complexIndicators.some((i) => lower.includes(i))) complexityScore += 3;
    if (moderateIndicators.some((i) => lower.includes(i))) complexityScore += 1;
    if (simpleIndicators.some((i) => lower.includes(i))) complexityScore -= 1;
    if (mentionedDomains >= 2) complexityScore += 2;
    if (isMultiFile) complexityScore += 1;
    if (taskDescription.length > 500) complexityScore += 1;

    if (complexityScore >= 3) return 'complex';
    if (complexityScore >= 1) return 'moderate';
    return 'simple';
  }

  /**
   * Score all agents for a task
   */
  private scoreAgents(taskDescription: string): Map<string, number> {
    const scores = new Map<string, number>();
    const words = this.tokenize(taskDescription);

    for (const agent of AGENT_REGISTRY) {
      let score = 0;

      // Keyword matching
      for (const keyword of agent.triggerKeywords) {
        const keywordParts = keyword.toLowerCase().split(/\s+/);

        // Full keyword match
        if (taskDescription.toLowerCase().includes(keyword.toLowerCase())) {
          score += 10;
          continue;
        }

        // Partial keyword matching
        for (const part of keywordParts) {
          if (words.some((w) => w.includes(part) || part.includes(w))) {
            score += 3;
          }
        }
      }

      // Domain mention boost
      if (taskDescription.toLowerCase().includes(agent.domain)) {
        score *= this.config.domainBoost;
      }

      // Priority weight
      score += agent.priority * 0.5;

      scores.set(agent.id, Math.round(score * 10) / 10);
    }

    return scores;
  }

  /**
   * Get maximum agents based on complexity
   */
  private getMaxAgentsForComplexity(complexity: TaskComplexity): number {
    switch (complexity) {
      case 'simple':
        return 1;
      case 'moderate':
        return 2;
      case 'complex':
        return Math.min(this.config.maxAgents, 4);
      default:
        return 2; // Default to moderate
    }
  }

  /**
   * Tokenize task description for matching
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
  }

  /**
   * Generate reasoning for agent selection
   */
  private generateReasoning(
    task: string,
    agents: AgentSpecialization[],
    scores: Map<string, number>,
    complexity: TaskComplexity,
  ): string {
    if (agents.length === 0) {
      return 'No specialized agents matched the task. Using general-purpose approach.';
    }

    const agentDescriptions = agents.map((a) => {
      const score = scores.get(a.id) || 0;
      return `${a.name} (score: ${score})`;
    });

    return (
      `Task complexity: ${complexity}. Selected ${agents.length} agent(s): ${agentDescriptions.join(' → ')}. ` +
      `Primary focus: ${agents[0].domain} domain.`
    );
  }

  /**
   * Get recommended execution order for selected agents
   * Uses topological sort when dependencies exist, falls back to domain-based ordering
   */
  getExecutionOrder(agents: AgentSpecialization[]): AgentSpecialization[] {
    // Check if any agent has explicit dependencies
    const hasDependencies = agents.some(
      (a) => a.dependencies && a.dependencies.length > 0,
    );

    if (hasDependencies) {
      return this.topologicalSort(agents);
    }

    // Fall back to domain-based ordering
    return this.sortByDomain(agents);
  }

  /**
   * Sort agents by domain priority (default ordering)
   */
  private sortByDomain(agents: AgentSpecialization[]): AgentSpecialization[] {
    // Define domain execution priority
    const domainOrder: Record<string, number> = {
      security: 1, // Security first
      database: 2, // Then database schema
      backend: 3, // Then API/backend
      frontend: 4, // Then frontend
      testing: 5, // Then tests
      documentation: 6, // Finally docs
      devops: 7, // DevOps last
      'ai-ml': 4, // AI alongside frontend
      general: 5, // General in middle
    };

    return [...agents].sort((a, b) => {
      const orderA = domainOrder[a.domain] || 5;
      const orderB = domainOrder[b.domain] || 5;
      return orderA - orderB;
    });
  }

  /**
   * Topological sort for dependency-aware agent ordering
   * Uses Kahn's algorithm for stable sorting
   * Falls back to domain ordering if circular dependencies are detected
   */
  private topologicalSort(
    agents: AgentSpecialization[],
  ): AgentSpecialization[] {
    const agentMap = new Map<string, AgentSpecialization>();
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    // Initialize data structures
    for (const agent of agents) {
      agentMap.set(agent.id, agent);
      inDegree.set(agent.id, 0);
      adjacency.set(agent.id, []);
    }

    // Build the dependency graph
    for (const agent of agents) {
      if (agent.dependencies) {
        for (const depId of agent.dependencies) {
          // Only consider dependencies that are in the selected agents list
          if (agentMap.has(depId)) {
            adjacency.get(depId)!.push(agent.id);
            inDegree.set(agent.id, (inDegree.get(agent.id) || 0) + 1);
          }
        }
      }
    }

    // Find all agents with no dependencies (in-degree 0)
    const queue: string[] = [];
    for (const [id, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    // Sort initial queue by domain order for deterministic output
    const domainSorted = this.sortByDomain(
      queue.map((id) => agentMap.get(id)!),
    );
    const sortedQueue = domainSorted.map((a) => a.id);

    const result: AgentSpecialization[] = [];
    let processedCount = 0;

    while (sortedQueue.length > 0) {
      const currentId = sortedQueue.shift()!;
      const currentAgent = agentMap.get(currentId);
      if (currentAgent) {
        result.push(currentAgent);
        processedCount++;
      }

      // Process dependents
      const dependents = adjacency.get(currentId) || [];
      const readyDependents: AgentSpecialization[] = [];

      for (const depId of dependents) {
        const newDegree = (inDegree.get(depId) || 1) - 1;
        inDegree.set(depId, newDegree);

        if (newDegree === 0) {
          const depAgent = agentMap.get(depId);
          if (depAgent) {
            readyDependents.push(depAgent);
          }
        }
      }

      // Sort newly ready agents by domain and add to queue
      const sortedReadyDependents = this.sortByDomain(readyDependents);
      for (const agent of sortedReadyDependents) {
        sortedQueue.push(agent.id);
      }
    }

    // Check for circular dependencies
    if (processedCount !== agents.length) {
      console.warn(
        '[AgentSelector] Circular dependency detected in agents, falling back to domain ordering',
      );
      return this.sortByDomain(agents);
    }

    return result;
  }
}
