/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExecutionReport, ExecutionPhase } from '../orchestrator/types.js';
import type { HybridModeManager } from './hybrid-mode-manager.js';

/**
 * Result of the /agentic command
 */
export interface AgenticCommandResult {
  success: boolean;
  message: string;
  report?: ExecutionReport;
}

/**
 * Handles the /agentic slash command
 * 
 * Usage:
 *   /agentic <task>     - Execute a task using multi-agent orchestration
 *   /agentic status     - Show agentic mode status and stats
 *   /agentic enable     - Enable agentic mode
 *   /agentic disable    - Disable agentic mode
 *   /agentic agents     - List available specialized agents
 *   /agentic trust      - Show trust levels for all agents
 */
export class AgenticCommand {
  constructor(private readonly manager: HybridModeManager) {}

  /**
   * Execute the /agentic command
   */
  async execute(
    args: string,
    workingDirectory: string,
    callbacks?: {
      onOutput?: (message: string) => void;
      onPhaseChange?: (phase: ExecutionPhase) => void;
      onApprovalRequired?: (plan: any) => Promise<boolean>;
    },
  ): Promise<AgenticCommandResult> {
    const trimmedArgs = args.trim();
    const [subcommand, ...rest] = trimmedArgs.split(/\s+/);

    switch (subcommand?.toLowerCase()) {
      case 'status':
        return this.handleStatus();

      case 'enable':
        return this.handleEnable();

      case 'disable':
        return this.handleDisable();

      case 'agents':
        return this.handleListAgents();

      case 'trust':
        return this.handleTrustStatus();

      case 'help':
      case '':
      case undefined:
        return this.handleHelp();

      default:
        // Treat as a task to execute
        return this.handleExecuteTask(
          trimmedArgs,
          workingDirectory,
          callbacks,
        );
    }
  }

  private handleStatus(): AgenticCommandResult {
    const enabled = this.manager.isEnabled();
    const stats = this.manager.getStats();
    const phase = this.manager.getCurrentPhase();

    let message = `## Agentic Mode Status\n\n`;
    message += `**Enabled:** ${enabled ? 'Yes' : 'No'}\n`;
    
    if (phase) {
      message += `**Current Phase:** ${phase}\n`;
    }

    if (stats) {
      message += `\n### Session Statistics\n`;
      message += `- Total Sessions: ${stats.totalSessions}\n`;
      message += `- Active Sessions: ${stats.activeSessions}\n`;
      message += `- Total Tasks: ${stats.totalTasks}\n`;
      message += `- Total Tokens: ${stats.totalTokens}\n`;

      if (Object.keys(stats.agentBreakdown).length > 0) {
        message += `\n### Agent Breakdown\n`;
        for (const [agentId, agentStats] of Object.entries(stats.agentBreakdown)) {
          message += `- **${agentStats.agentName}**: ${agentStats.taskCount} tasks, ${agentStats.tokenCount} tokens\n`;
        }
      }
    }

    return { success: true, message };
  }

  private handleEnable(): AgenticCommandResult {
    this.manager.enable();
    return {
      success: true,
      message: 'Agentic mode enabled. Tasks will now use multi-agent orchestration.',
    };
  }

  private handleDisable(): AgenticCommandResult {
    this.manager.disable();
    return {
      success: true,
      message: 'Agentic mode disabled. Returning to single-agent mode.',
    };
  }

  private handleListAgents(): AgenticCommandResult {
    // Import agent registry
    const { AGENT_REGISTRY } = require('../agents/specialized/agent-registry.js');
    
    let message = `## Available Specialized Agents\n\n`;
    
    // Group by domain
    const byDomain: Record<string, any[]> = {};
    for (const agent of AGENT_REGISTRY) {
      if (!byDomain[agent.domain]) {
        byDomain[agent.domain] = [];
      }
      byDomain[agent.domain].push(agent);
    }

    for (const [domain, agents] of Object.entries(byDomain)) {
      message += `### ${domain.charAt(0).toUpperCase() + domain.slice(1)}\n`;
      for (const agent of agents) {
        message += `- **${agent.name}** (${agent.modelTier}) - ${agent.triggerKeywords.slice(0, 3).join(', ')}...\n`;
      }
      message += `\n`;
    }

    return { success: true, message };
  }

  private handleTrustStatus(): AgenticCommandResult {
    const { AGENT_REGISTRY } = require('../agents/specialized/agent-registry.js');
    
    let message = `## Agent Trust Levels\n\n`;
    message += `| Agent | Trust Level | Requires Approval |\n`;
    message += `|-------|-------------|-------------------|\n`;

    for (const agent of AGENT_REGISTRY) {
      const trust = this.manager.getAgentTrust(agent.id);
      if (trust) {
        message += `| ${agent.name} | ${trust.level} | ${trust.privileges.requiresApproval ? 'Yes' : 'No'} |\n`;
      } else {
        message += `| ${agent.name} | L1_SUPERVISED | Yes |\n`;
      }
    }

    return { success: true, message };
  }

  private handleHelp(): AgenticCommandResult {
    const message = `
## Agentic Mode Commands

\`/agentic <task>\` - Execute a task using multi-agent orchestration
\`/agentic status\` - Show agentic mode status and statistics
\`/agentic enable\` - Enable agentic mode
\`/agentic disable\` - Disable agentic mode
\`/agentic agents\` - List available specialized agents
\`/agentic trust\` - Show trust levels for all agents
\`/agentic help\` - Show this help message

### How it works

1. **Task Analysis**: Your task is analyzed to determine which specialized agents are needed
2. **Agent Selection**: The most appropriate agents are selected (e.g., security-auditor, react-specialist)
3. **Execution Plan**: A plan is created showing the execution order and trust levels
4. **Snapshot**: A safety snapshot is created before any changes
5. **Agent Execution**: Each agent works in isolation with its own context
6. **Quality Gates**: Validation checks ensure code quality
7. **Report**: A comprehensive report is generated

### Example

\`\`\`
/agentic Add user authentication with JWT tokens and refresh rotation
\`\`\`

This would activate: auth-security, api-designer, database-architect, unit-test-writer
`.trim();

    return { success: true, message };
  }

  private async handleExecuteTask(
    task: string,
    workingDirectory: string,
    callbacks?: {
      onOutput?: (message: string) => void;
      onPhaseChange?: (phase: ExecutionPhase) => void;
      onApprovalRequired?: (plan: any) => Promise<boolean>;
    },
  ): Promise<AgenticCommandResult> {
    if (!this.manager.isEnabled()) {
      return {
        success: false,
        message: 'Agentic mode is not enabled. Run `/agentic enable` first.',
      };
    }

    try {
      callbacks?.onOutput?.(`Starting agentic execution for: ${task}\n`);

      const report = await this.manager.executeTask(task, workingDirectory, {
        onPhaseChange: callbacks?.onPhaseChange,
        onApprovalRequired: callbacks?.onApprovalRequired,
      });

      let message = this.formatReport(report);

      return {
        success: report.success,
        message,
        report,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Agentic execution failed: ${errorMessage}`,
      };
    }
  }

  private formatReport(report: ExecutionReport): string {
    let message = `## Agentic Execution Report\n\n`;
    
    message += `**Task:** ${report.task}\n`;
    message += `**Status:** ${report.success ? 'Success' : 'Failed'}\n`;
    message += `**Duration:** ${report.totalDurationMs}ms\n\n`;

    if (report.error) {
      message += `**Error:** ${report.error}\n\n`;
    }

    message += `### Agent Executions\n\n`;
    for (const execution of report.agentExecutions) {
      const status = execution.success ? '✓' : '✗';
      message += `${status} **${execution.agentName}** (${execution.durationMs}ms)\n`;
      
      if (execution.toolsUsed.length > 0) {
        message += `  - Tools: ${execution.toolsUsed.join(', ')}\n`;
      }
      
      if (execution.filesModified.length > 0) {
        message += `  - Modified: ${execution.filesModified.join(', ')}\n`;
      }
      
      if (execution.error) {
        message += `  - Error: ${execution.error}\n`;
      }
    }

    if (report.qualityGateResults.length > 0) {
      message += `\n### Quality Gates\n\n`;
      for (const gate of report.qualityGateResults) {
        const status = gate.passed ? '✓' : '✗';
        message += `${status} **${gate.name}**`;
        if (gate.message) {
          message += ` - ${gate.message}`;
        }
        message += `\n`;
      }
    }

    if (report.snapshotId) {
      message += `\n*Snapshot ID: ${report.snapshotId}*\n`;
    }

    return message;
  }
}
