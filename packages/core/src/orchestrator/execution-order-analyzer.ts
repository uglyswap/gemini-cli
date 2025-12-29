/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Execution Order Analyzer
 * Dynamically determines optimal agent execution order based on task analysis.
 * Replaces static domain ordering with intelligent task-aware sequencing.
 */

import type {
  SpecializedAgent,
  AgentDomain,
} from '../agents/specialized/types.js';

/**
 * Task analysis result
 */
export interface TaskAnalysis {
  /** Primary domain for this task */
  primaryDomain: AgentDomain;
  /** Secondary domains involved */
  secondaryDomains: AgentDomain[];
  /** Keywords detected in the task */
  detectedKeywords: string[];
  /** Whether this task involves data layer changes */
  involvesDataLayer: boolean;
  /** Whether this task involves UI changes */
  involvesUI: boolean;
  /** Whether this task is security-sensitive */
  isSecuritySensitive: boolean;
  /** Whether this task requires testing */
  requiresTesting: boolean;
  /** Task type classification */
  taskType:
    | 'feature'
    | 'bugfix'
    | 'refactor'
    | 'security'
    | 'performance'
    | 'documentation'
    | 'unknown';
}

/**
 * Keyword patterns for task analysis
 */
const KEYWORD_PATTERNS: Record<
  string,
  { keywords: string[]; domains: AgentDomain[] }
> = {
  // UI/Frontend patterns
  ui: {
    keywords: [
      'ui',
      'interface',
      'component',
      'react',
      'vue',
      'svelte',
      'css',
      'style',
      'layout',
      'responsive',
      'button',
      'form',
      'modal',
      'page',
      'view',
    ],
    domains: ['frontend'],
  },
  // Backend/API patterns
  api: {
    keywords: [
      'api',
      'endpoint',
      'route',
      'controller',
      'service',
      'server',
      'rest',
      'graphql',
      'middleware',
      'handler',
      'request',
      'response',
    ],
    domains: ['backend'],
  },
  // Database patterns
  database: {
    keywords: [
      'database',
      'db',
      'schema',
      'migration',
      'query',
      'sql',
      'table',
      'model',
      'orm',
      'prisma',
      'drizzle',
      'supabase',
      'postgres',
      'mysql',
      'mongodb',
    ],
    domains: ['database'],
  },
  // Security patterns
  security: {
    keywords: [
      'security',
      'auth',
      'authentication',
      'authorization',
      'permission',
      'role',
      'token',
      'jwt',
      'oauth',
      'password',
      'encrypt',
      'vulnerability',
      'xss',
      'csrf',
      'injection',
    ],
    domains: ['security'],
  },
  // Testing patterns
  testing: {
    keywords: [
      'test',
      'testing',
      'spec',
      'unit',
      'integration',
      'e2e',
      'coverage',
      'mock',
      'jest',
      'vitest',
      'playwright',
      'cypress',
    ],
    domains: ['testing'],
  },
  // DevOps patterns
  devops: {
    keywords: [
      'deploy',
      'deployment',
      'ci',
      'cd',
      'pipeline',
      'docker',
      'kubernetes',
      'terraform',
      'infrastructure',
      'config',
      'environment',
      'build',
      'release',
    ],
    domains: ['devops'],
  },
  // AI/ML patterns
  aiml: {
    keywords: [
      'ai',
      'ml',
      'machine learning',
      'model',
      'training',
      'inference',
      'embedding',
      'vector',
      'llm',
      'prompt',
      'agent',
      'neural',
      'tensorflow',
      'pytorch',
    ],
    domains: ['ai-ml'],
  },
  // Documentation patterns
  documentation: {
    keywords: [
      'doc',
      'documentation',
      'readme',
      'comment',
      'jsdoc',
      'typedoc',
      'swagger',
      'openapi',
      'guide',
      'tutorial',
    ],
    domains: ['documentation'],
  },
};

/**
 * Task type detection patterns
 */
const TASK_TYPE_PATTERNS: Record<string, string[]> = {
  feature: ['add', 'create', 'implement', 'new', 'feature', 'build'],
  bugfix: [
    'fix',
    'bug',
    'issue',
    'error',
    'broken',
    'repair',
    'correct',
    'patch',
  ],
  refactor: [
    'refactor',
    'reorganize',
    'restructure',
    'clean',
    'improve',
    'optimize',
    'simplify',
  ],
  security: [
    'security',
    'vulnerability',
    'audit',
    'harden',
    'protect',
    'secure',
  ],
  performance: [
    'performance',
    'speed',
    'optimize',
    'fast',
    'slow',
    'latency',
    'cache',
  ],
  documentation: ['document', 'readme', 'guide', 'explain', 'describe'],
};

/**
 * Dependency rules: which domains should run before others
 */
const DOMAIN_DEPENDENCIES: Record<AgentDomain, AgentDomain[]> = {
  security: [], // Security first - no dependencies
  database: ['security'], // Schema changes after security review
  backend: ['database', 'security'], // API after schema
  'ai-ml': ['backend', 'database'], // AI features need backend/data
  frontend: ['backend', 'ai-ml'], // UI after backend APIs exist
  testing: ['frontend', 'backend', 'database'], // Tests after implementation
  documentation: ['testing'], // Docs after everything is tested
  devops: ['testing', 'documentation'], // Deploy last
  general: [], // General can be anywhere
};

/**
 * ExecutionOrderAnalyzer class
 */
export class ExecutionOrderAnalyzer {
  /**
   * Analyze a task and return task analysis
   */
  analyzeTask(task: string): TaskAnalysis {
    const lowerTask = task.toLowerCase();
    const detectedKeywords: string[] = [];
    const domainScores: Record<AgentDomain, number> = {
      frontend: 0,
      backend: 0,
      database: 0,
      security: 0,
      testing: 0,
      devops: 0,
      'ai-ml': 0,
      documentation: 0,
      general: 0,
    };

    // Score each domain based on keyword matches
    for (const [, pattern] of Object.entries(KEYWORD_PATTERNS)) {
      for (const keyword of pattern.keywords) {
        if (lowerTask.includes(keyword)) {
          detectedKeywords.push(keyword);
          for (const domain of pattern.domains) {
            domainScores[domain] += 1;
          }
        }
      }
    }

    // Determine primary and secondary domains
    const sortedDomains = (
      Object.entries(domainScores) as Array<[AgentDomain, number]>
    )
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1]);

    const primaryDomain: AgentDomain =
      sortedDomains.length > 0 ? sortedDomains[0][0] : 'general';
    const secondaryDomains: AgentDomain[] = sortedDomains
      .slice(1)
      .map(([domain]) => domain);

    // Detect task type
    let taskType: TaskAnalysis['taskType'] = 'unknown';
    for (const [type, patterns] of Object.entries(TASK_TYPE_PATTERNS)) {
      if (patterns.some((p) => lowerTask.includes(p))) {
        taskType = type as TaskAnalysis['taskType'];
        break;
      }
    }

    return {
      primaryDomain,
      secondaryDomains,
      detectedKeywords: [...new Set(detectedKeywords)],
      involvesDataLayer: domainScores.database > 0,
      involvesUI: domainScores.frontend > 0,
      isSecuritySensitive:
        domainScores.security > 0 ||
        detectedKeywords.some((k) =>
          ['password', 'token', 'auth', 'permission'].includes(k),
        ),
      requiresTesting:
        domainScores.testing > 0 ||
        taskType === 'feature' ||
        taskType === 'bugfix',
      taskType,
    };
  }

  /**
   * Determine optimal execution order for agents based on task analysis
   */
  determineExecutionOrder(
    agents: SpecializedAgent[],
    task: string,
  ): SpecializedAgent[] {
    const analysis = this.analyzeTask(task);

    // Calculate priority for each agent
    const agentPriorities: Array<{
      agent: SpecializedAgent;
      priority: number;
    }> = agents.map((agent) => {
      let priority = 0;

      // Base priority from static domain order
      priority += this.getBaseDomainPriority(agent.domain);

      // Boost for primary domain
      if (agent.domain === analysis.primaryDomain) {
        priority += 100;
      }

      // Boost for secondary domains
      if (analysis.secondaryDomains.includes(agent.domain)) {
        priority += 50;
      }

      // Special handling for security-sensitive tasks
      if (analysis.isSecuritySensitive && agent.domain === 'security') {
        priority += 200; // Security goes first
      }

      // Special handling for data layer changes
      if (analysis.involvesDataLayer && agent.domain === 'database') {
        priority += 150; // Database changes early
      }

      // Adjust based on task type
      priority += this.getTaskTypePriorityAdjustment(
        agent.domain,
        analysis.taskType,
      );

      return { agent, priority };
    });

    // Sort by priority (higher = earlier execution)
    agentPriorities.sort((a, b) => b.priority - a.priority);

    // Apply dependency constraints
    const orderedAgents = this.applyDependencyConstraints(
      agentPriorities.map((p) => p.agent),
    );

    return orderedAgents;
  }

  /**
   * Get base priority for a domain (lower = earlier execution)
   */
  private getBaseDomainPriority(domain: AgentDomain): number {
    const basePriorities: Record<AgentDomain, number> = {
      security: 90, // Security validation first
      database: 80, // Schema before backend
      backend: 70, // API before frontend
      'ai-ml': 65, // AI alongside backend
      frontend: 60, // UI after backend
      testing: 40, // Tests after implementation
      documentation: 30, // Docs after testing
      devops: 20, // DevOps last
      general: 50, // General in the middle
    };
    return basePriorities[domain];
  }

  /**
   * Get priority adjustment based on task type
   */
  private getTaskTypePriorityAdjustment(
    domain: AgentDomain,
    taskType: TaskAnalysis['taskType'],
  ): number {
    const adjustments: Record<string, Record<AgentDomain, number>> = {
      bugfix: {
        testing: 30, // Testing important for bugfixes
        frontend: 0,
        backend: 0,
        database: 0,
        security: 10,
        devops: 0,
        'ai-ml': 0,
        documentation: -10,
        general: 0,
      },
      security: {
        security: 100, // Security agent is critical
        testing: 20,
        frontend: -20,
        backend: 10,
        database: 10,
        devops: 0,
        'ai-ml': -10,
        documentation: -20,
        general: 0,
      },
      performance: {
        backend: 30,
        database: 30,
        frontend: 20,
        testing: 20,
        security: 0,
        devops: 10,
        'ai-ml': 0,
        documentation: -20,
        general: 0,
      },
      documentation: {
        documentation: 100,
        testing: -20,
        frontend: -20,
        backend: -20,
        database: -20,
        security: -20,
        devops: -20,
        'ai-ml': -20,
        general: 0,
      },
      feature: {
        frontend: 0,
        backend: 0,
        database: 0,
        security: 10,
        testing: 0,
        devops: 0,
        'ai-ml': 0,
        documentation: 0,
        general: 0,
      },
      refactor: {
        testing: 40, // Tests important for refactoring
        frontend: 0,
        backend: 0,
        database: 0,
        security: 0,
        devops: 0,
        'ai-ml': 0,
        documentation: 0,
        general: 0,
      },
      unknown: {
        frontend: 0,
        backend: 0,
        database: 0,
        security: 0,
        testing: 0,
        devops: 0,
        'ai-ml': 0,
        documentation: 0,
        general: 0,
      },
    };

    return adjustments[taskType]?.[domain] ?? 0;
  }

  /**
   * Apply dependency constraints to ensure correct ordering
   */
  private applyDependencyConstraints(
    agents: SpecializedAgent[],
  ): SpecializedAgent[] {
    const result: SpecializedAgent[] = [];
    const remaining = [...agents];
    const processed = new Set<string>();

    // Keep adding agents whose dependencies are satisfied
    while (remaining.length > 0) {
      let added = false;

      for (let i = 0; i < remaining.length; i++) {
        const agent = remaining[i];
        const dependencies = DOMAIN_DEPENDENCIES[agent.domain] || [];

        // Check if all dependencies are either:
        // 1. Already processed
        // 2. Not in our agent list (so we don't need to wait for them)
        const dependenciesSatisfied = dependencies.every((depDomain) => {
          const depAgentInList = agents.find((a) => a.domain === depDomain);
          return !depAgentInList || processed.has(depDomain);
        });

        if (dependenciesSatisfied) {
          result.push(agent);
          processed.add(agent.domain);
          remaining.splice(i, 1);
          added = true;
          break;
        }
      }

      // If we couldn't add any agent, there might be a circular dependency
      // Add the first remaining agent to break the cycle
      if (!added && remaining.length > 0) {
        const agent = remaining.shift()!;
        result.push(agent);
        processed.add(agent.domain);
      }
    }

    return result;
  }

  /**
   * Get recommended parallel execution groups based on analysis
   */
  getParallelGroups(
    agents: SpecializedAgent[],
    task: string,
  ): Array<{
    groupId: number;
    agents: SpecializedAgent[];
    canParallelize: boolean;
  }> {
    const orderedAgents = this.determineExecutionOrder(agents, task);
    const groups: Array<{
      groupId: number;
      agents: SpecializedAgent[];
      canParallelize: boolean;
    }> = [];

    let currentGroup: SpecializedAgent[] = [];
    let currentGroupDomains = new Set<AgentDomain>();
    let groupId = 0;

    for (const agent of orderedAgents) {
      const dependencies = DOMAIN_DEPENDENCIES[agent.domain] || [];

      // Check if this agent can be parallelized with current group
      const canAddToGroup = !dependencies.some((dep) =>
        currentGroupDomains.has(dep),
      );

      if (canAddToGroup && currentGroup.length < 4) {
        // Add to current parallel group (max 4 agents per group)
        currentGroup.push(agent);
        currentGroupDomains.add(agent.domain);
      } else {
        // Start new group
        if (currentGroup.length > 0) {
          groups.push({
            groupId,
            agents: currentGroup,
            canParallelize: currentGroup.length > 1,
          });
          groupId++;
        }
        currentGroup = [agent];
        currentGroupDomains = new Set([agent.domain]);
      }
    }

    // Add final group
    if (currentGroup.length > 0) {
      groups.push({
        groupId,
        agents: currentGroup,
        canParallelize: currentGroup.length > 1,
      });
    }

    return groups;
  }
}

/**
 * Create an ExecutionOrderAnalyzer instance
 */
export function createExecutionOrderAnalyzer(): ExecutionOrderAnalyzer {
  return new ExecutionOrderAnalyzer();
}
