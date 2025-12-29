/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AGENT_REGISTRY } from '@google/gemini-cli-core';
import { CommandKind, type SlashCommand } from './types.js';

/**
 * /agentic command - Access the multi-agent orchestration system
 *
 * Usage:
 *   /agentic agents     - List all 28 specialized agents
 *   /agentic status     - Show agentic mode status
 *   /agentic help       - Show help information
 */
export const agenticCommand: SlashCommand = {
  name: 'agentic',
  altNames: ['agents'],
  description: 'Multi-agent orchestration system with 28 specialized agents',
  kind: CommandKind.BUILT_IN,
  action: (context, args) => {
    const trimmedArgs = args.trim().toLowerCase();
    const subcommand = trimmedArgs.split(/\s+/)[0] || 'help';

    switch (subcommand) {
      case 'agents':
      case 'list':
        return listAgents();

      case 'status':
        return showStatus(context);

      case 'help':
      default:
        return showHelp();
    }
  },
  subCommands: [
    {
      name: 'agents',
      altNames: ['list'],
      description: 'List all 28 specialized agents by domain',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: () => listAgents(),
    },
    {
      name: 'status',
      description: 'Show agentic mode status',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: (context) => showStatus(context),
    },
    {
      name: 'help',
      description: 'Show help for the agentic system',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: () => showHelp(),
    },
  ],
};

function listAgents(): {
  type: 'message';
  messageType: 'info';
  content: string;
} {
  // Group agents by domain
  const byDomain: Record<string, typeof AGENT_REGISTRY> = {};
  for (const agent of AGENT_REGISTRY) {
    if (!byDomain[agent.domain]) {
      byDomain[agent.domain] = [];
    }
    byDomain[agent.domain].push(agent);
  }

  let content = `## Multi-Agent System - ${AGENT_REGISTRY.length} Specialized Agents\n\n`;

  for (const [domain, agents] of Object.entries(byDomain)) {
    const domainTitle = domain.charAt(0).toUpperCase() + domain.slice(1);
    content += `### ${domainTitle} (${agents.length} agents)\n`;
    for (const agent of agents) {
      const keywords = agent.triggerKeywords.slice(0, 4).join(', ');
      content += `- **${agent.name}** _(${agent.modelTier})_ - ${keywords}...\n`;
    }
    content += '\n';
  }

  content += `---\n`;
  content += `**Usage:** Describe your task naturally and the system will automatically select the most appropriate agent(s).\n`;
  content += `**Example:** "Create a React component with TypeScript" will engage the Frontend Developer agent.\n`;

  return {
    type: 'message',
    messageType: 'info',
    content,
  };
}

function showStatus(context: import('./types.js').CommandContext): {
  type: 'message';
  messageType: 'info';
  content: string;
} {
  const config = context.services.config;
  const isEnabled = config?.isAgentsEnabled() ?? false;

  let content = `## Agentic System Status\n\n`;
  content += `- **Agents Enabled:** ${isEnabled ? 'Yes' : 'No'}\n`;
  content += `- **Specialized Agents:** ${AGENT_REGISTRY.length}\n`;
  content += `- **Domains:** ${new Set(AGENT_REGISTRY.map((a) => a.domain)).size}\n\n`;

  if (!isEnabled) {
    content += `> To enable the full agentic system, set \`enableAgents: true\` in your config.\n`;
  }

  return {
    type: 'message',
    messageType: 'info',
    content,
  };
}

function showHelp(): { type: 'message'; messageType: 'info'; content: string } {
  const content = `## Agentic System Help

The **Multi-Agent Orchestration System** provides 28 specialized agents across 8 domains:

| Domain | Agents | Focus |
|--------|--------|-------|
| Frontend | 5 | React, UI/UX, CSS, Testing, Performance |
| Backend | 4 | API, Database, Security, Architecture |
| DevOps | 3 | CI/CD, Docker, Kubernetes |
| Data | 3 | Analytics, ML, ETL |
| Security | 3 | Audit, Penetration, Compliance |
| Documentation | 2 | Technical Writing, API Docs |
| Quality | 4 | Testing, Code Review, Performance |
| Integration | 4 | APIs, Webhooks, Third-party |

### Commands
- \`/agentic agents\` - List all specialized agents
- \`/agentic status\` - Show system status
- \`/agentic help\` - This help message

### How it works
Simply describe your task and the system will:
1. Analyze your request
2. Select the most appropriate agent(s)
3. Execute with specialized expertise
4. Apply quality gates before completion
`;

  return {
    type: 'message',
    messageType: 'info',
    content,
  };
}
